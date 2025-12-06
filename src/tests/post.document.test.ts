import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import { app, appService } from '../main.ts';
import { mockClient } from 'aws-sdk-client-mock';
import { INGESTION_API_TOKEN } from '../config/config.ts';

beforeAll(async () => {
  await appService.createAdminUser();
  mockClient(S3Client);
});

const mockFile = {
  fieldname: 'file',
  originalname: 'test.pdf',
  encoding: '7bit',
  mimetype: 'pdf',
  buffer: Buffer.from('test data'),
  size: 1024,
};

test('should upload a file succesfully', async () => {
  const mockFileBuffer = Buffer.from('this is a test file content');

  const { status, body } = await request(app)
    .post('/api/documents')
    .attach('file', mockFileBuffer, 'test-file.txt') // Field name, buffer, filename
    .set('x-api-token', INGESTION_API_TOKEN);
  expect(status).toBe(201);

  const document = await appService.fetchDocument(body.documentId);

  expect(document).toEqual({
    documentId: body.documentId,
    createdAt: body.createdAt,
    fileName: body.fileName,
    status: body.status,
    mimetype: body.mimetype,
    size: body.size,
  });
});
