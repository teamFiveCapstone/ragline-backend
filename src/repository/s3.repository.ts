import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export class S3Repository {
  private client: S3Client;
  private bucketName: string;

  constructor(region: string, bucketName: string) {
    this.client = new S3Client({ region });
    this.bucketName = bucketName;
  }

  async connect() {
    console.log('S3 client initialized successfully!');
  }

  async uploadDocument(fileName: string, fileBuffer: Buffer, contentType: string) {
    const key = fileName;

    const uploadParams = {
      Bucket: this.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    };

    const result = await this.client.send(new PutObjectCommand(uploadParams));

  //    {
  //   // Unique identifier for the uploaded object
  //   ETag: '"d41d8cd98f00b204e9800998ecf8427e"',

  //   // Server-side encryption info (if enabled)
  //   ServerSideEncryption: 'AES256',

  //   // Version ID if versioning is enabled on bucket
  //   VersionId: 'null',

  //   // Additional metadata
  //   $metadata: {
  //     httpStatusCode: 200,
  //     requestId: 'ABC123DEF456',
  //     extendedRequestId: 'xyz789...',
  //     attempts: 1,
  //     totalRetryDelay: 0
  //   }
  // }

    return {
      key,
      location: `https://${this.bucketName}.s3.amazonaws.com/${key}`,
      etag: result.ETag,
    };
  }

  async deleteDocument(key: string) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    const result = await this.client.send(command);
    return { key, deleted: true, versionId: result.VersionId };
  }
}