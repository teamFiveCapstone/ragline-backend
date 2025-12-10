import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, INGESTION_API_TOKEN } from '../config/config';
import logger from '../logger';

export const authenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const publicRoutes = ['/api/login', '/health', '/api/docs', '/api/docs.json'];

  if (publicRoutes.includes(req.path)) {
    logger.info('Skipping auth for public route', {
      method: req.method,
      path: req.path,
    });
    return next();
  }

  const apiToken = req.headers['x-api-token'] as string | undefined;
  if (apiToken && INGESTION_API_TOKEN === apiToken) {
    logger.info('Request authenticated via ingestion API token', {
      method: req.method,
      path: req.path,
    });
    return next();
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  const queryToken = req.query.token as string | undefined;

  let jwtToken: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    jwtToken = authHeader.split(' ')[1];
  } else if (queryToken) {
    jwtToken = queryToken;
  }

  if (!jwtToken) {
    logger.warn(
      'Authentication failed: no valid x-api-token, auth header, or query token',
      {
        method: req.method,
        path: req.path,
      }
    );
    return res.status(403).json({ error: 'Authentication required' });
  }

  const jwtSecret = JWT_SECRET;
  if (!jwtSecret) {
    logger.error('JWT_SECRET not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    jwt.verify(jwtToken, jwtSecret);

    logger.info('Request authenticated via JWT', {
      method: req.method,
      path: req.path,
    });

    return next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn('JWT authentication failed: token expired', {
        method: req.method,
        path: req.path,
      });
      return res
        .status(403)
        .json({ error: 'Token expired, please sign in again.' });
    } else if (error instanceof jwt.JsonWebTokenError) {
      logger.warn('JWT authentication failed: invalid token', {
        method: req.method,
        path: req.path,
      });
      return res.status(403).json({ error: 'Invalid token' });
    } else {
      logger.error('JWT authentication failed: unknown error', {
        method: req.method,
        path: req.path,
        error,
      });
      return res.status(403).json({ error: 'Authentication failed' });
    }
  }
};
