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
import type { DocumentData } from './service/types';
import { DocumentStatus } from './service/types';
import logger from './logger';

const sseClients: express.Response[] = [];

let cleanupInterval: NodeJS.Timeout | null = null;

function broadcastDocumentUpdate(document: DocumentData) {
  logger.info('Broadcasting SSE document update', {
    clientCount: sseClients.length,
    documentId: document.documentId,
    status: document.status,
  });

  const data = `data: ${JSON.stringify(document)}\n\n`;
  sseClients.forEach((res) => res.write(data));
}

export const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const requestId = randomUUID();
  (req as any).requestId = requestId;

  const start = Date.now();

  logger.info('Incoming request', {
    method: req.method,
    url: req.originalUrl,
  });

  res.on('finish', () => {
    const durationMs = Date.now() - start;

    logger.info('Request completed', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
});

app.use(authenticateMiddleware);

app.get('/api/events', (req, res) => {
  logger.info('SSE client connected');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  sseClients.push(res);

  req.on('close', () => {
    logger.info('SSE client disconnected');

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
      const documentId = (req as any).documentId;
      const extension = file.originalname.split('.').pop();
      const keyWithExtension = extension
        ? `${documentId}.${extension}`
        : documentId;
      cb(null, keyWithExtension);
    },
    contentType: multerS3.AUTO_CONTENT_TYPE,
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

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
      logger.info('Login failed: invalid credentials', { userName });
      return res.status(403).json({ error: 'Invalid credentials' });
    }

    logger.info('Login successful', { userName });
    res.json({ jwt: result });
  } catch (error) {
    logger.error('Login error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/documents', async (req, res) => {
  const STATUS = 'all';

  const status =
    typeof req.query.status === 'string'
      ? req.query.status.toLowerCase()
      : STATUS;

  const lastEvaluatedKey =
    typeof req.query.lastEvaluatedKey === 'string'
      ? req.query.lastEvaluatedKey
      : undefined;

  try {
    const results = await appService.fetchAllDocuments(
      status,
      lastEvaluatedKey
    );

    logger.info('Fetched documents list', {
      status,
      hasMore: !!results.lastEvaluatedKey,
    });

    res.json(results);
  } catch (error) {
    logger.error('Fetch documents error', { error, status });
    res.status(404).json({ error: 'Documents not found' });
  }
});

app.get('/api/documents/:id', async (req, res) => {
  const documentId = req.params.id;

  try {
    const result = await appService.fetchDocument(documentId);

    if (!result) {
      logger.info('Document not found', { documentId });
      return res.status(404).json({ error: 'Document not found' });
    }

    logger.info('Fetched document', { documentId });
    res.json(result);
  } catch (error) {
    logger.error('Fetch document error', { error, documentId });
    res.status(404).json({ error: 'Document not found' });
  }
});

app.post(
  '/api/documents',
  (req, res, next) => {
    (req as any).documentId = randomUUID();
    next();
  },
  upload.single('file'),
  async (req, res) => {
    try {
      const file = req.file;
      const documentId = (req as any).documentId;

      if (!file) {
        logger.info('Upload attempt with no file');
        return res.status(400).json({ error: 'No file uploaded' });
      }

      logger.info('Uploading new document', {
        documentId,
        fileName: file.originalname,
        size: file.size,
        mimetype: file.mimetype,
      });

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
      logger.error('Upload error', { error });
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

app.patch('/api/documents/:id', async (req, res) => {
  const documentId = req.params.id;
  const requestBody = req.body;

  try {
    const result = await appService.updateDocument(documentId, requestBody);

    logger.info('Updated document', { documentId, status: result.status });

    broadcastDocumentUpdate(result);

    res.json(result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    logger.error('Update document error', {
      documentId,
      errorMessage,
      rawError: error,
    });

    res.status(500).json({ error: errorMessage });
  }
});

app.delete('/api/documents/:id', async (req, res) => {
  const documentId = req.params.id;

  try {
    const document = await appService.fetchDocument(documentId);
    if (!document) {
      logger.info('Delete attempted on missing document', { documentId });
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.status === DocumentStatus.RUNNING) {
      logger.info('Delete blocked: document still processing', {
        documentId,
      });

      return res.status(409).json({
        error: 'Cannot delete while processing. Wait for completion.',
      });
    }

    const s3Repo = new S3Repository(AWS_REGION, S3_BUCKET_NAME);
    await s3Repo.connect();
    const extension = document.fileName.split('.').pop();
    const s3Key = extension ? `${documentId}.${extension}` : documentId;
    await s3Repo.deleteDocument(s3Key);

    const updatedDoc = await appService.updateDocument(documentId, {
      status: DocumentStatus.DELETING,
    });

    logger.info('Delete initiated', {
      documentId,
      s3Key,
      status: DocumentStatus.DELETING,
    });

    broadcastDocumentUpdate(updatedDoc);

    if (!cleanupInterval) {
      cleanupInterval = setInterval(cleanupDeletedDocuments, 10000);
      logger.info('[Cleanup] Started (10s interval)');
    }

    res.status(202).json({
      message: 'Delete initiated',
      documentId,
      status: DocumentStatus.DELETING,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Delete error', { documentId, error: msg, rawError: error });
    res.status(500).json({ error: msg });
  }
});

async function cleanupDeletedDocuments() {
  logger.info('[Cleanup] Checking for documents to finalize...');
  try {
    const deleted = await appService.fetchAllDocuments(DocumentStatus.DELETED);
    const deleting = await appService.fetchAllDocuments(
      DocumentStatus.DELETING
    );

    logger.info('[Cleanup] Status', {
      deletedCount: deleted.items.length,
      deletingCount: deleting.items.length,
    });

    for (const doc of deleted.items) {
      try {
        await appService.finalizeDocumentDeletion(doc.documentId);
        logger.info('[Cleanup] Finalized document', {
          documentId: doc.documentId,
        });
      } catch (error) {
        logger.error('[Cleanup] Failed to finalize document', {
          documentId: doc.documentId,
          error,
        });
      }
    }

    if (deleted.items.length === 0 && deleting.items.length === 0) {
      if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        logger.info('[Cleanup] No pending deletes, stopping interval');
      }
    }
  } catch (error) {
    logger.error('[Cleanup] Error while checking documents', { error });
  }
}

app.listen(PORT, async () => {
  await appRepository.connect();
  await appService.createAdminUser();
  logger.info('Management API listening', { port: PORT });
});
