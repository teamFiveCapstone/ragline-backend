import { beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import { app, appService } from '../main.ts';
import { INGESTION_API_TOKEN } from '../config/config.ts';

beforeAll(async () => {
  await appService.createAdminUser();
});

test('that getting specific document by id works', async () => {
  appService.createDocument(
    { fileName: 'Lion', size: 50, mimetype: 'pdf', createdAt: '12-3-2025' },
    '18903458904'
  );
  appService.createDocument(
    { fileName: 'Tiger', size: 50, mimetype: 'pdf', createdAt: '12-4-2025' },
    '33kfgsljb'
  );
  const response = await request(app)
    .get('/api/documents/33kfgsljb')
    .set('x-api-token', INGESTION_API_TOKEN);
  expect(response.body.fileName).toEqual("Tiger");
});
