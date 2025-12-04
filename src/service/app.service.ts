import { AppRepository } from '../repository/app.repository';
import { DocumentData } from './types';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/config';
import logger from '../logger';

export class AppService {
  private appRepository: AppRepository;

  constructor(appRepository: AppRepository) {
    this.appRepository = appRepository;
  }

  async createDocument(
    documentData: Omit<DocumentData, 'documentId' | 'status'>,
    documentId: string
  ) {
    logger.info('Creating document record', {
      documentId,
      fileName: documentData.fileName,
    });

    const result = await this.appRepository.createDocument(
      documentData,
      documentId
    );
    return result;
  }

  async fetchDocument(documentId: string): Promise<DocumentData> {
    logger.info('Fetching document', { documentId });

    const document = await this.appRepository.fetchDocument(documentId);
    return document;
  }

  async fetchAllDocuments(
    status: string,
    lastEvaluatedKeyFromPreviousResponse?: string
  ): Promise<{
    items: DocumentData[];
    lastEvaluatedKey?: Record<string, any>;
  }> {
    logger.info('Fetching documents list', {
      status,
      lastEvaluatedKeyFromPreviousResponse,
    });

    const documents = await this.appRepository.fetchAllDocuments(
      status,
      lastEvaluatedKeyFromPreviousResponse
    );
    return documents;
  }

  async updateDocument(
    documentId: string,
    requestBody: { status: string }
  ): Promise<DocumentData> {
    logger.info('Updating document', {
      documentId,
      newStatus: requestBody.status,
    });

    const document = await this.appRepository.updateDocument(
      documentId,
      requestBody
    );

    return document;
  }

  async finalizeDocumentDeletion(documentId: string) {
    logger.info('Finalizing document deletion', { documentId });
    await this.appRepository.deleteDocument(documentId);
  }

  async fetchAdminUser() {
    logger.info('Fetching admin user');
    return await this.appRepository.getAdminUser();
  }

  async createAdminUser() {
    try {
      logger.info('Ensuring admin user exists');

      const user = await this.fetchAdminUser();

      if (user) {
        logger.info('Admin user already exists, skipping creation');
        return;
      }

      const hashedPassword = await bcrypt.hash(
        process.env.ADMIN_PASSWORD || 'password',
        3
      );

      await this.appRepository.createAdminUser(hashedPassword);
      logger.info('Admin user created successfully');
    } catch (error) {
      logger.error('Failed to create admin user', { error });
    }
  }

  async authenticateUser(
    password: string,
    passwordHash: string
  ): Promise<boolean> {
    try {
      const match = await bcrypt.compare(password, passwordHash);
      return match;
    } catch (error) {
      logger.error('Error during password comparison', { error });
      return false;
    }
  }

  async login(userName: string, password: string): Promise<string | null> {
    try {
      logger.info('Login attempt', { userName });

      const user = await this.fetchAdminUser();

      if (!user) {
        logger.error('Login failed: no admin user found');
        return null;
      }

      const username = user.userName;
      const passwordHash = user.password;

      if (username !== userName) {
        logger.info('Login failed: username mismatch', {
          expectedUserName: username,
          providedUserName: userName,
        });
        return null;
      }

      const authenticated = await this.authenticateUser(password, passwordHash);
      if (!authenticated) {
        logger.info('Login failed: invalid password', { userName });
        return null;
      }

      if (!JWT_SECRET) {
        logger.error('JWT_SECRET is not configured');
        throw new Error('JWT_SECRET is not configured');
      }

      const token = jwt.sign(
        {
          userName: username,
        },
        JWT_SECRET,
        { expiresIn: '2h' }
      );

      logger.info('Login successful', { userName });
      return token;
    } catch (error) {
      logger.error('Error during login', { error, userName });
      return null;
    }
  }
}
