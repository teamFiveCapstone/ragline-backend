import { beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import { app, appService } from '../main.ts';
import { DocumentData } from '../service/types.ts';
import { INGESTION_API_TOKEN } from '../config/config.ts';

beforeAll(async () => {
  await appService.createAdminUser();
});

test('that getting documents works', async () => {
  appService.createDocument(
    { fileName: 'Lion', size: 50, mimetype: 'pdf', createdAt: '12-3-2025' },
    '18903458904'
  );
  appService.createDocument(
    { fileName: 'Tiger', size: 50, mimetype: 'pdf', createdAt: '12-4-2025' },
    '33kfgsljb'
  );
  const response = await request(app)
    .get('/api/documents')
    .set('x-api-token', INGESTION_API_TOKEN);

  const newDocuments = response.body.items.filter((item: DocumentData) => {
    return item.documentId === '33kfgsljb' || item.documentId === '18903458904';
  });

  expect(newDocuments.length).toBe(2);
});
