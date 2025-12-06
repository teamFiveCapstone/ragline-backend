import { beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import { app, appService } from '../main.ts';
import { INGESTION_API_TOKEN } from '../config/config.ts';

beforeAll(async () => {
  await appService.createAdminUser();
});

test('changing status from pending to finished', async () => {
  appService.createDocument(
    { fileName: 'Lion', size: 50, mimetype: 'pdf', createdAt: '12-3-2025' },
    '18903458904'
  );
  const response = await request(app)
    .patch('/api/documents/18903458904')
    .send({status: "finished"})
    .set('x-api-token', INGESTION_API_TOKEN);
  expect(response.body.status).toEqual("finished");
});