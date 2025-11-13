import { PutCommandOutput } from '@aws-sdk/lib-dynamodb';
import { AppRepository } from '../repository/app.repository';
import { DocumentData } from './types';

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

    const result = await this.appRepository.createDocument(documentData, documentId);
    return result;
  }

  async fetchDocument(documentId: string): Promise<DocumentData> {
    const document = await this.appRepository.fetchDocument(documentId);

    return document;
  }

  // TODO: fix type for requestBody, need new Document type with only a status property
  async updateDocument(documentId: string, requestBody: { status: '' }) {
    const document = await this.appRepository.updateDocument(documentId, requestBody);

    return document;
  }
}
