import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { DocumentData, DocumentStatus } from '../service/types';

export class AppRepository {
  private client: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor(region: string, tableName: string) {
    this.client = new DynamoDBClient({ region });
    this.docClient = DynamoDBDocumentClient.from(this.client);
    this.tableName = tableName;
  }

  async connect() {
    console.log('DynamoDB client initialized successfully!');
  }

  async createDocument(
    documentData: Omit<DocumentData, 'documentId' | 'status'>
  ): Promise<string> {
    const documentId = crypto.randomUUID();

    const command = new PutCommand({
      TableName: this.tableName,
      Item: {
        documentId,
        status: DocumentStatus.PENDING,
        fileName: documentData.fileName,
        createdAt: new Date().toISOString(),
        size: documentData.size,
        mimetype: documentData.mimetype,
      },
    });

    const result = await this.docClient.send(command);
    if (result.$metadata.httpStatusCode !== 200) {
      throw new Error('failed to write document to dynamodb');
    }

    return documentId;
  }

  async fetchDocument(docuemntId: string): Promise<DocumentData> {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        documentId: docuemntId,
      },
    });

    const response = await this.docClient.send(command);
    
    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`failed to fetch document: ${docuemntId}`)
    }

    return response.Item as DocumentData;
  }
}
