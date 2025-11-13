import { PutCommandOutput } from '@aws-sdk/lib-dynamodb';
import { AppRepository } from '../repository/app.repository';
import { DocumentData } from './types';

export class AppService {
  private appRepository: AppRepository;

  constructor(appRepository: AppRepository) {
    this.appRepository = appRepository;
  }

  async createDocument(
    documentData: Omit<DocumentData, 'documentId' | 'status'>
  ) {
    console.log(`Creating document record: ${documentData.fileName}`);

    const documentId = await this.appRepository.createDocument(documentData);
    return documentId;
  }

  async fetchDocument(documentId: string): Promise<DocumentData> {
    const document = await this.appRepository.fetchDocument(documentId);

    return document;
  }
}
