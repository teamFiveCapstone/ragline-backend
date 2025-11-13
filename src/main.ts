import {
  AWS_REGION,
  PORT,
  S3_BUCKET_NAME,
  DYNAMODB_TABLE_NAME,
} from './config/config';
import { AppRepository } from './repository/app.repository';
import { AppService } from './service/app.service';
import express from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
const app = express();

// Create S3 client for multer-s3
const s3Client = new S3Client({ region: AWS_REGION });

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: S3_BUCKET_NAME,
    key: (req, file, cb) => {
      // Use original filename as S3 key
      cb(null, file.originalname);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// TODO: Set up real logger (Winston or Pino)

const appRepository = new AppRepository(AWS_REGION, DYNAMODB_TABLE_NAME);
const appService = new AppService(appRepository);

app.post('/api/documents', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const documentId = await appService.createDocument({
      fileName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    });

    const result = await appService.fetchDocument(documentId);

    res.json(result);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.listen(PORT, async () => {
  await appRepository.connect();
  console.log('Listening to port 3000.');
});
