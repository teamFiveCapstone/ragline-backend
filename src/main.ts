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
import { randomUUID } from 'crypto';
const app = express();

// Parse JSON request bodies
app.use(express.json());

// Create S3 client for multer-s3
const s3Client = new S3Client({ region: AWS_REGION });

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: S3_BUCKET_NAME,
    key: (req, file, cb) => {
      // Use documentId from req and preserve file extension
      const documentId = (req as any).documentId;
      const extension = file.originalname.split('.').pop();
      const keyWithExtension = extension ? `${documentId}.${extension}` : documentId;
      cb(null, keyWithExtension);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// TODO: Set up real logger (Winston or Pino)

const appRepository = new AppRepository(AWS_REGION, DYNAMODB_TABLE_NAME);
const appService = new AppService(appRepository);

//TODO: not implemented
app.get('/api/documents', async (req, res) => {
  const page = req.query.page;
  const limit = req.query.limit;
  const status = req.query.status ?? 'all';
});

app.get('/api/documents/:id', async (req, res) => {
  const documentId = req.params.id;

  try {
    const result = await appService.fetchDocument(documentId);
    res.json(result);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(404).json({ error: 'Document not found' });
  }
});

app.post('/api/documents',
  // First: Generate documentId and attach to req
  (req, res, next) => {
    (req as any).documentId = randomUUID();
    next();
  },
  // Second: Upload with custom key using documentId
  upload.single('file'),
  // Third: Route handler
  async (req, res) => {
    try {
      const file = req.file;
      const documentId = (req as any).documentId; // Use the pre-generated ID

      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      await appService.createDocument({
        fileName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
      }, documentId);

      const result = await appService.fetchDocument(documentId);

      res.json(result);
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

app.patch('/api/documents/:id', async (req, res) => {
  const documentId = req.params.id;
  const requestBody = req.body;

  try {
    const result = await appService.updateDocument(documentId, requestBody);
    res.json(result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    console.error('Update error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
});

app.listen(PORT, async () => {
  await appRepository.connect();
  console.log('Listening to port 3000.');
});
