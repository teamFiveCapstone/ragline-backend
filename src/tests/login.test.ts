import { beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import { app, appService } from '../main.ts';

beforeAll(async () => {
  await appService.createAdminUser();
});

test('login endpoint with correct credentials', async () => {
  const response = await request(app)
    .post('/api/login')
    .send({ userName: 'admin', password: 'password' });
  expect(response.status).toEqual(200);
});

test('login endpoint with incorrectcorrect password', async () => {
  const response = await request(app)
    .post('/api/login')
    .send({ userName: 'admin', password: 'none' });
  expect(response.status).toEqual(403);
});

test('login endpoint with incorrectcorrect username', async () => {
  const response = await request(app)
    .post('/api/login')
    .send({ userName: 'samantha', password: 'password' });
  expect(response.status).toEqual(403);
});

test('login endpoint with incorrectcorrect username and password', async () => {
  const response = await request(app)
    .post('/api/login')
    .send({ userName: 'samantha', password: 'none' });
  expect(response.status).toEqual(403);
});
