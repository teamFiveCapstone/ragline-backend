import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DocumentData, DocumentStatus, UsersData } from '../service/types';

export class AppRepository {
  private client: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;
  private documentsTable: string;
  private usersTable: string;

  constructor(region: string, documentsTable: string, usersTable: string) {
    this.client = new DynamoDBClient({ region });
    this.docClient = DynamoDBDocumentClient.from(this.client);
    this.documentsTable = documentsTable;
    this.usersTable = usersTable;
  }

  async connect() {
    console.log('DynamoDB client initialized successfully!');
  }

  async createDocument(
    documentData: Omit<DocumentData, 'documentId' | 'status'>,
    documentId: string
  ): Promise<string> {
    const command = new PutCommand({
      TableName: this.documentsTable,
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

  async fetchDocument(documentId: string): Promise<DocumentData> {
    const command = new GetCommand({
      TableName: this.documentsTable,
      Key: {
        documentId: documentId,
      },
    });

    const response = await this.docClient.send(command);

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`failed to fetch document: ${documentId}`);
    }

    return response.Item as DocumentData;
  }

  async updateDocument(documentId: string, requestBody: { status: string }) {
    const command = new UpdateCommand({
      TableName: this.documentsTable,
      Key: {
        documentId: documentId,
      },
      UpdateExpression: 'set #status = :status', // only need the # here because status is a reserved keyword for dynamodb
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': requestBody.status,
      },
      ReturnValues: 'ALL_NEW',
    });

    const response = await this.docClient.send(command);

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`Failed to update document: ${documentId}`);
    }

    return response.Attributes as DocumentData;
  }

  async fetchDocumentsByStatus(
    page: number,
    limit: number,
    status: string
  ): Promise<DocumentData[]> {
    return [];
  }

  async fetchAllDocuments(
    page: number,
    limit: number,
    status: string
  ): Promise<DocumentData[]> {
    try {
      if (status === 'all') {
        const command = new ScanCommand({
          TableName: this.documentsTable,
        });

        const response = await this.docClient.send(command);

        if (response.$metadata.httpStatusCode !== 200) {
          throw new Error(`Failed to fetch documents`);
        }

        return (response.Items as DocumentData[]) || [];
      }

      const command = new QueryCommand({
        TableName: this.documentsTable,
        IndexName: 'status-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
        },
      });

      const response = await this.docClient.send(command);

      if (response.$metadata.httpStatusCode !== 200) {
        throw new Error(`Failed to fetch documents with status: ${status}`);
      }

      return (response.Items as DocumentData[]) || [];
    } catch (error) {
      console.error('Error fetching documents:', error);
      throw new Error('Failed to fetch documents from database');
    }
  }

  async createAdminUser(hashedPassword: string): Promise<void> {
    const command = new PutCommand({
      TableName: this.usersTable,
      Item: {
        userName: 'admin',
        password: hashedPassword,
      },
    });

    const result = await this.docClient.send(command);
    if (result.$metadata.httpStatusCode !== 200) {
      throw new Error('failed to created admin on dynamodb');
    }
  }
  async getAdminUser(): Promise<UsersData> {
    const command = new GetCommand({
      TableName: this.usersTable,
      Key: {
        userName: 'admin',
      },
    });

    const response = await this.docClient.send(command);

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`Failed to fetch user: ${command}`);
    }

    return response.Item as UsersData;
  }
}
