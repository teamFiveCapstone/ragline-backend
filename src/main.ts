import {
  AWS_REGION,
  PORT,
  S3_BUCKET_NAME,
  DYNAMODB_TABLE_NAME,
  DYNAMODB_TABLE_USERS,
} from './config/config';
import { AppRepository } from './repository/app.repository';
import { AppService } from './service/app.service';
import express from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
const app = express();

app.use(express.json());

const s3Client = new S3Client({ region: AWS_REGION });

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: S3_BUCKET_NAME,
    key: (req, file, cb) => {
      // Use documentId from req and preserve file extension
      const documentId = (req as any).documentId;
      const extension = file.originalname.split('.').pop();
      const keyWithExtension = extension
        ? `${documentId}.${extension}`
        : documentId;
      cb(null, keyWithExtension);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// TODO: Set up real logger (Winston or Pino)

const appRepository = new AppRepository(
  AWS_REGION,
  DYNAMODB_TABLE_NAME,
  DYNAMODB_TABLE_USERS
);
const appService = new AppService(appRepository);

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.post('/login', async (req, res) => {
  // const users = await db
  //   .select()
  //   .from(usersTable)
  //   .where(eq(usersTable.name, req.body.userName));
  // const passwordHash = users[0]?.password;
  // const authenticated = await bcrypt.compare(req.body.password, passwordHash);
  // if (!authenticated) {
  //   res.status(401).send();
  //   return;
  // }
  // const jwtSecret = process.env.JWT_SECRET;
  // if (!jwtSecret) {
  //   throw new Error('no jwt secret');
  // }
  // const token = jwt.sign(
  //   {
  //     userName: 'admin',
  //   },
  //   jwtSecret,
  //   { expiresIn: '1h' }
  // );
  // res.json({ jwt: token });
});

app.get('/api/documents', async (req, res) => {
  const PAGE_NUMBER = 1;
  const LIMIT = 10;
  const STATUS = 'all';

  const page =
    typeof req.query.page === 'string' ? +req.query.page : PAGE_NUMBER;
  const limit = typeof req.query.limit === 'string' ? +req.query.limit : LIMIT;
  const status =
    typeof req.query.status === 'string'
      ? req.query.status.toLowerCase()
      : STATUS;

  try {
    const results = await appService.fetchAllDocuments(page, limit, status); // array of documents

    res.json(results);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(404).json({ error: 'Documents not found' });
  }
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

app.post(
  '/api/documents',
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

      await appService.createDocument(
        {
          fileName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
        },
        documentId
      );

      const result = await appService.fetchDocument(documentId);

      res.status(201).json(result);
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
  await appService.createAdminUser();
  console.log('Listening to port 3000.');
});
