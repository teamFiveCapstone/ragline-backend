import dotenv from 'dotenv';

dotenv.config();

export const PORT = process.env.PORT ?? 3000;
export const AWS_ACESS_KEY_ID = process.env.AWS_ACESS_KEY_ID ?? '';
export const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? '';
export const AWS_REGION = process.env.AWS_REGION ?? '';
export const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME ?? '';
export const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME ?? '';
export const DYNAMODB_TABLE_USERS = process.env.DYNAMODB_TABLE_USERS ?? '';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
export const JWT_SECRET = process.env.JWT_SECRET ?? '';
export const INGESTION_API_TOKEN = process.env.INGESTION_API_TOKEN ?? '';
export const IS_TEST_ENV = process.env.IS_TEST_ENV ?? '';