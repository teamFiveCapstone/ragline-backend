import { expect, test } from 'vitest';
import request from 'supertest';
import { app } from '../main.ts';

test('login route', async () => {
  const response = await request(app).get('/health');
  expect(response.status).toEqual(200);
});
