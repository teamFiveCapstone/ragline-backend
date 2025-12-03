import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DocumentData, DocumentStatus, UsersData } from '../service/types';
import { IS_TEST_ENV } from '../config/config';

export class AppRepository {
  private client: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;
  private documentsTable: string;
  private usersTable: string;
  private readonly DEFAULT_LIMIT = 10;

  constructor(region: string, documentsTable: string, usersTable: string) {
    if (IS_TEST_ENV) {
      this.client = new DynamoDBClient({
        region,
        endpoint: 'http://localhost:8000',
      });
    } else {
      this.client = new DynamoDBClient({
        region,
      });
    }
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

  async deleteDocument(documentId: string): Promise<void> {
    const command = new DeleteCommand({
      TableName: this.documentsTable,
      Key: { documentId },
    });

    const response = await this.docClient.send(command);
    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`Failed to delete: ${documentId}`);
    }
  }

  async fetchDocumentsByStatus(status: string): Promise<DocumentData[]> {
    return [];
  }

  private async fetchAllDocumentsByAllStatuses(
    lastEvaluatedKeyFromPreviousResponse?: string
  ): Promise<{
    items: DocumentData[];
    lastEvaluatedKey?: Record<string, any>;
  }> {
    // Parse cursor - format: { lastCreatedAt: "ISO string", lastEvaluatedKeys: {...} }
    let cursor: {
      lastCreatedAt?: string;
      lastEvaluatedKeys?: Record<string, Record<string, any>>;
    } = {};
    if (lastEvaluatedKeyFromPreviousResponse) {
      try {
        cursor = JSON.parse(lastEvaluatedKeyFromPreviousResponse);
      } catch (error) {
        throw new Error('Invalid lastEvaluatedKey format');
      }
    }

    // Fetch enough items per status to ensure we get a good mix across all statuses
    // Fetch 10x the limit to have plenty of items from all statuses for global sorting
    const fetchLimit = this.DEFAULT_LIMIT * 10;

    // Query all status values in parallel with descending order
    const allStatuses = Object.values(DocumentStatus);
    const queryPromises = allStatuses.map((statusValue) => {
      const exclusiveStartKey = cursor.lastEvaluatedKeys?.[statusValue];
      return this.docClient.send(
        new QueryCommand({
          TableName: this.documentsTable,
          IndexName: 'status-createdAt-index',
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': statusValue },
          Limit: fetchLimit,
          ExclusiveStartKey: exclusiveStartKey,
          ScanIndexForward: false, // Descending order (newest first)
        })
      );
    });

    const responses = await Promise.all(queryPromises);

    // Combine all items and track last evaluated key for each status
    const allItems: DocumentData[] = [];
    const newLastEvaluatedKeys: Record<string, Record<string, any>> = {};

    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      const statusValue = allStatuses[i];

      if (response.$metadata.httpStatusCode !== 200) {
        throw new Error('Failed to fetch documents');
      }

      if (response.Items) {
        // Filter out items we've already seen (if cursor exists)
        const filteredItems = cursor.lastCreatedAt
          ? response.Items.filter(
              (item) => (item.createdAt as string) < cursor.lastCreatedAt!
            )
          : response.Items;

        allItems.push(...(filteredItems as DocumentData[]));
      }

      // Store pagination state for this status
      if (response.LastEvaluatedKey) {
        newLastEvaluatedKeys[statusValue] = response.LastEvaluatedKey;
      }
    }

    // Sort all combined items by createdAt in descending order (newest first)
    const sortedItems = allItems.sort((a, b) => {
      const dateA = a.createdAt || '';
      const dateB = b.createdAt || '';
      return dateB > dateA ? 1 : dateB < dateA ? -1 : 0;
    });

    // Take only the DEFAULT_LIMIT items after sorting
    const limitedItems = sortedItems.slice(0, this.DEFAULT_LIMIT);

    // Create cursor for next page
    // Use the last item's createdAt and all status pagination keys
    const lastItem = limitedItems[limitedItems.length - 1];
    const hasMoreItems =
      Object.keys(newLastEvaluatedKeys).length > 0 ||
      sortedItems.length > this.DEFAULT_LIMIT;

    const lastEvaluatedKey = hasMoreItems
      ? {
          lastCreatedAt: lastItem?.createdAt,
          lastEvaluatedKeys: newLastEvaluatedKeys,
        }
      : undefined;

    return {
      items: limitedItems,
      lastEvaluatedKey,
    };
  }

  private async fetchAllDocumentsByStatus(
    status: string,
    lastEvaluatedKeyFromPreviousResponse?: string
  ): Promise<{
    items: DocumentData[];
    lastEvaluatedKey?: Record<string, any>;
  }> {
    let exclusiveStartKey: Record<string, any> | undefined;
    if (lastEvaluatedKeyFromPreviousResponse) {
      try {
        exclusiveStartKey = JSON.parse(lastEvaluatedKeyFromPreviousResponse);
      } catch (error) {
        throw new Error('Invalid lastEvaluatedKey format');
      }
    }

    const command = new QueryCommand({
      TableName: this.documentsTable,
      IndexName: 'status-createdAt-index',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
      },
      Limit: this.DEFAULT_LIMIT,
      ExclusiveStartKey: exclusiveStartKey,
      ScanIndexForward: false,
    });

    const response = await this.docClient.send(command);

    if (response.$metadata.httpStatusCode !== 200) {
      throw new Error(`Failed to fetch documents with status: ${status}`);
    }

    return {
      items: (response.Items as DocumentData[]) || [],
      lastEvaluatedKey: response.LastEvaluatedKey,
    };
  }

  async fetchAllDocuments(
    status: string,
    lastEvaluatedKeyFromPreviousResponse?: string
  ): Promise<{
    items: DocumentData[];
    lastEvaluatedKey?: Record<string, any>;
  }> {
    try {
      if (status === 'all') {
        return await this.fetchAllDocumentsByAllStatuses(
          lastEvaluatedKeyFromPreviousResponse
        );
      }

      return await this.fetchAllDocumentsByStatus(
        status,
        lastEvaluatedKeyFromPreviousResponse
      );
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
