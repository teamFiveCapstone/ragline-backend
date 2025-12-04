import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import logger from '../logger';

export class S3Repository {
  private client: S3Client;
  private bucketName: string;

  constructor(region: string, bucketName: string) {
    this.client = new S3Client({ region });
    this.bucketName = bucketName;
  }

  async connect() {
    logger.info('S3 client initialized', {
      bucketName: this.bucketName,
    });
  }

  async uploadDocument(
    fileName: string,
    fileBuffer: Buffer,
    contentType: string
  ) {
    const key = fileName;

    logger.info('Uploading document to S3', {
      bucketName: this.bucketName,
      key,
      contentType,
    });

    const uploadParams = {
      Bucket: this.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    };

    const result = await this.client.send(new PutObjectCommand(uploadParams));

    const statusCode = result.$metadata.httpStatusCode;
    if (statusCode && (statusCode < 200 || statusCode >= 300)) {
      logger.error('Failed to upload document to S3', {
        bucketName: this.bucketName,
        key,
        statusCode,
      });
      throw new Error('Failed to upload document to S3');
    }

    logger.info('Uploaded document to S3 successfully', {
      bucketName: this.bucketName,
      key,
      etag: result.ETag,
    });

    return {
      key,
      location: `https://${this.bucketName}.s3.amazonaws.com/${key}`,
      etag: result.ETag,
    };
  }

  async deleteDocument(key: string) {
    logger.info('Deleting document from S3', {
      bucketName: this.bucketName,
      key,
    });

    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const result = await this.client.send(command);

    const statusCode = result.$metadata.httpStatusCode;
    if (statusCode && (statusCode < 200 || statusCode >= 300)) {
      logger.error('Failed to delete document from S3', {
        bucketName: this.bucketName,
        key,
        statusCode,
      });
      throw new Error(`Failed to delete S3 object: ${key}`);
    }

    logger.info('Deleted document from S3 successfully', {
      bucketName: this.bucketName,
      key,
      versionId: result.VersionId,
    });

    return { key, deleted: true, versionId: result.VersionId };
  }
}
