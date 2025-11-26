import { PutCommandOutput } from '@aws-sdk/lib-dynamodb';
import { AppRepository } from '../repository/app.repository';
import { DocumentData } from './types';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/config';

export class AppService {
  private appRepository: AppRepository;

  constructor(appRepository: AppRepository) {
    this.appRepository = appRepository;
  }

  async createDocument(
    documentData: Omit<DocumentData, 'documentId' | 'status'>,
    documentId: string
  ) {
    console.log(`Creating document record: ${documentData.fileName}`);

    const result = await this.appRepository.createDocument(
      documentData,
      documentId
    );
    return result;
  }

  async fetchDocument(documentId: string): Promise<DocumentData> {
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
    const documents = await this.appRepository.fetchAllDocuments(
      status,
      lastEvaluatedKeyFromPreviousResponse
    );
    return documents;
  }

  // TODO: fix type for requestBody, need new Document type with only a status property
  async updateDocument(documentId: string, requestBody: { status: '' }) {
    const document = await this.appRepository.updateDocument(
      documentId,
      requestBody
    );

    return document;
  }

  async fetchAdminUser() {
    return await this.appRepository.getAdminUser();
  }

  async createAdminUser() {
    try {
      const user = await this.fetchAdminUser();

      if (user) {
        return;
      }
      const hashedPassword = await bcrypt.hash(
        process.env.ADMIN_PASSWORD || 'password',
        3
      );
      await this.appRepository.createAdminUser(hashedPassword);
    } catch (error) {
      console.error('Failed to create admin user:', error);
    }
  }

  async authenticateUser(
    password: string,
    passwordHash: string
  ): Promise<boolean> {
    try {
      return await bcrypt.compare(password, passwordHash);
    } catch (error) {
      console.error('Error during password comparison:', error);
      return false;
    }
  }

  async login(userName: string, password: string): Promise<string | null> {
    try {
      const user = await this.fetchAdminUser();

      if (!user) {
        return null;
      }

      const username = user.userName;
      const passwordHash = user.password;

      if (username !== userName) {
        return null;
      }

      const authenticated = await this.authenticateUser(password, passwordHash);
      if (!authenticated) {
        return null;
      }

      if (!JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured');
      }

      const token = jwt.sign(
        {
          userName: username,
        },
        JWT_SECRET,
        { expiresIn: '2h' }
      );

      return token;
    } catch (error) {
      console.error('Error during login:', error);
      return null;
    }
  }
}
