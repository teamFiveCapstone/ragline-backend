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
import { Request, Response } from 'express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Burrow Pipeline API',
      version: '1.0.0',
    },
  },
  apis: [__filename], // Use current file for annotations
};

const openapiSpecification = swaggerJsdoc(options);

// 1. DocumentData schema - matches your TypeScript interface with all properties
// 2. Error schema - for error responses
// 3. ApiKeyAuth security scheme - defines the x-api-token header authentication
/**
 * @openapi
 * components:
 *   schemas:
 *     DocumentData:
 *       type: object
 *       properties:
 *         documentId:
 *           type: string
 *         fileName:
 *           type: string
 *         size:
 *           type: number
 *         status:
 *           type: string
 *           enum: [pending, running, finished, failed, deleting, deleted, delete_failed]
 *         mimetype:
 *           type: string
 *         createdAt:
 *           type: string
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *   securitySchemes:
 *     ApiKeyAuth:
 *       type: apiKey
 *       in: header
 *       name: x-api-token
 */

// Random globally scoped variables (i.e. code smell, can this be a property on some class? or on the app object?)
const sseClients: express.Response[] = [];
let cleanupInterval: NodeJS.Timeout | null = null;

// Random function (i.e. code smell, can this be a method on the service?)
function broadcastDocumentUpdate(document: DocumentData) {
  logger.info('Broadcasting SSE document update', {
    clientCount: sseClients.length,
    documentId: document.documentId,
    status: document.status,
  });

  const data = `data: ${JSON.stringify(document)}\n\n`;
  sseClients.forEach((res) => res.write(data));
}

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

// App dependencies
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

// Initialize app
export const app = express();

// Middleware
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
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpecification));
app.get('/api/docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(openapiSpecification);
});
app.use(authenticateMiddleware);

// Routes
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

/**
 * @openapi
 * /api/documents:
 *   get:
 *     summary: Retrieve a list of documents
 *     description: Fetches all documents with optional filtering by status and pagination support
 *     tags: [Documents]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [all, pending, running, finished, failed, deleting, deleted, delete_failed]
 *           default: all
 *         description: Filter documents by status
 *       - in: query
 *         name: lastEvaluatedKey
 *         schema:
 *           type: string
 *         description: Pagination key for retrieving next page of results
 *     responses:
 *       200:
 *         description: Successfully retrieved documents list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/DocumentData'
 *                 lastEvaluatedKey:
 *                   type: string
 *                   description: Key for pagination to get next page
 *       404:
 *         description: Documents not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid or missing API token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/documents/{id}:
 *   get:
 *     summary: Get a specific document by ID
 *     description: Retrieves information about a single document
 *     tags: [Documents]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique identifier of the document
 *     responses:
 *       200:
 *         description: Document retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DocumentData'
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid or missing API token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/documents:
 *   post:
 *     summary: Upload a new document
 *     description: Uploads a new document
 *     tags: [Documents]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The document file to upload (max 50MB)
 *             required:
 *               - file
 *     responses:
 *       201:
 *         description: Document uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DocumentData'
 *       400:
 *         description: Bad request - No file uploaded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid or missing API token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error - Upload failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post(
  '/api/documents',
  (req: Request, res: Response, next) => {
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

/**
 * @openapi
 * /api/documents/{id}:
 *   delete:
 *     summary: Delete a document
 *     description: Initiates document deletion process
 *     tags: [Documents]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique identifier of the document to delete
 *     responses:
 *       202:
 *         description: Delete initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Delete initiated
 *                 documentId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [deleting]
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       409:
 *         description: Conflict - Cannot delete while document is processing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - Invalid or missing API token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error - Delete failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

app.listen(PORT, async () => {
  await appRepository.connect();
  await appService.createAdminUser();
  logger.info('Management API listening', { port: PORT });
});
