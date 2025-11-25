import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, INGESTION_API_TOKEN } from '../config/config';

export const authenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const publicRoutes = ['/api/login', '/health'];

  if (publicRoutes.includes(req.path)) {
    return next();
  }

  const apiToken = req.headers['x-api-token'] as string;
  if (apiToken && INGESTION_API_TOKEN === apiToken) {
    console.log('request successfully authenticated via api token');
    return next();
  }

  const authHeader = req.headers['authorization'] as string;
  const queryToken = req.query.token as string;

  let jwtToken: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    jwtToken = authHeader.split(' ')[1];
  } else if (queryToken) {
    jwtToken = queryToken;
  }

  if (!jwtToken) {
    console.log('authentication failed: no valid x-api-token, auth header, or query param token provided');
    return res.status(403).json({ error: 'Authentication required' });
  }

  const jwtSecret = JWT_SECRET;
  if (!jwtSecret) {
    console.error('JWT_SECRET not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    jwt.verify(jwtToken, jwtSecret);
    console.log('request successfully authenticated via jwt');
    return next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      console.log('jwt authentication failed: token expired');
      return res.status(403).json({ error: 'Token expired, please sign in again.' });
    } else if (error instanceof jwt.JsonWebTokenError) {
      console.log('jwt authentication failed: invalid token');
      return res.status(403).json({ error: 'Invalid token' });
    } else {
      console.log('jwt authentication failed: unknown error', error);
      return res.status(403).json({ error: 'Authentication failed' });
    }
  }
};
