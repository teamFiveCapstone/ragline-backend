import {
  AWS_REGION,
  PORT,
  S3_BUCKET_NAME,
  DYNAMODB_TABLE_NAME,
  DYNAMODB_TABLE_USERS,
} from './config/config';
import { AppRepository } from './repository/app.repository';
import { S3Repository } from './repository/s3.repository';
import { AppService } from './service/app.service';
import express from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { authenticateMiddleware } from './middleware/authentication-middleware';

//ZACH Added Type import for SSE
import type { DocumentData } from './service/types';
import { DocumentStatus } from './service/types';

//ZACH ADDED Active SSE connections
const sseClients: express.Response[] = [];

// Cleanup job interval (starts on DELETE, stops when idle)
let cleanupInterval: NodeJS.Timeout | null = null;

//ZACH ADDED Function used to push updated document data to all connected clients
function broadcastDocumentUpdate(document: DocumentData) {
  //For debugging
  console.log('Broadcasting SSE update to', sseClients.length, 'clients');
  console.log(document);

  const data = `data: ${JSON.stringify(document)}\n\n`;
  sseClients.forEach((res) => res.write(data));
}

export const app = express();
app.use(authenticateMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/events', (req, res) => {
  console.log('SSE client connected');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  sseClients.push(res);

  req.on('close', () => {
    console.log('SSE client disconnected');
    clearInterval(heartbeat);

    const index = sseClients.indexOf(res);
    if (index !== -1) sseClients.splice(index, 1);
  });
});

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
export const appService = new AppService(appRepository);

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.post('/api/login', async (req, res) => {
  try {
    const { userName, password } = req.body;

    if (!userName || !password) {
      return res
        .status(400)
        .json({ error: 'Username and password are required' });
    }

    const result = await appService.login(userName, password);

    if (!result) {
      return res.status(403).json({ error: 'Invalid credentials' });
    }

    res.json({ jwt: result });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/documents', async (req, res) => {
  const STATUS = 'all';

  const status =
    typeof req.query.status === 'string'
      ? req.query.status.toLowerCase()
      : STATUS;

  // Get lastEvaluated from query param, or use undefined if not provided
  const lastEvaluatedKey =
    typeof req.query.lastEvaluatedKey === 'string'
      ? req.query.lastEvaluatedKey
      : undefined;

  try {
    const results = await appService.fetchAllDocuments(
      status,
      lastEvaluatedKey
    );
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

    //ZACH ADDED SSE Update
    broadcastDocumentUpdate(result);

    res.json(result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    console.error('Update error:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  const documentId = req.params.id;

  try {
    const document = await appService.fetchDocument(documentId);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Reject if still processing
    if (document.status === DocumentStatus.RUNNING) {
      return res.status(409).json({
        error: 'Cannot delete while processing. Wait for completion.',
      });
    }

    // Delete S3 (triggers EventBridge → ingestion deletes embeddings)
    const s3Repo = new S3Repository(AWS_REGION, S3_BUCKET_NAME);
    await s3Repo.connect();
    const extension = document.fileName.split('.').pop();
    const s3Key = extension ? `${documentId}.${extension}` : documentId;
    await s3Repo.deleteDocument(s3Key);

    // Set status to deleting
    const updatedDoc = await appService.updateDocument(documentId, {
      status: DocumentStatus.DELETING,
    });

    broadcastDocumentUpdate(updatedDoc);

    // Start cleanup job if not already running
    if (!cleanupInterval) {
      cleanupInterval = setInterval(cleanupDeletedDocuments, 10000); // 10s
      console.log('[Cleanup] Started (10s interval)');
    }

    res.status(202).json({
      message: 'Delete initiated',
      documentId,
      status: DocumentStatus.DELETING,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Delete error:', msg);
    res.status(500).json({ error: msg });
  }
});

// Cleanup job: finalize deletion of status='deleted' documents
async function cleanupDeletedDocuments() {
  console.log('[Cleanup] Checking for documents to finalize...');
  try {
    const deleted = await appService.fetchAllDocuments(DocumentStatus.DELETED);
    const deleting = await appService.fetchAllDocuments(
      DocumentStatus.DELETING
    );

    console.log(
      `[Cleanup] Found ${deleted.items.length} deleted, ${deleting.items.length} deleting`
    );

    // Finalize 'deleted' documents (remove from DynamoDB)
    for (const doc of deleted.items) {
      try {
        await appService.finalizeDocumentDeletion(doc.documentId);
        console.log(`[Cleanup] Finalized: ${doc.documentId}`);
      } catch (error) {
        console.error(`[Cleanup] Failed to finalize ${doc.documentId}:`, error);
      }
    }

    // Stop interval if no pending deletes
    if (deleted.items.length === 0 && deleting.items.length === 0) {
      if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        console.log('[Cleanup] No pending deletes, stopping interval');
      }
    }
  } catch (error) {
    console.error('[Cleanup] Error:', error);
  }
}

app.listen(PORT, async () => {
  await appRepository.connect();
  await appService.createAdminUser();
  console.log('Listening to port 3000.');
});
