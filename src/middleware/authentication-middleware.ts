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

  const apiToken = req.headers['x-api-token'];
  if (INGESTION_API_TOKEN === apiToken) {
    console.log('request successfully authenticated via api token');
    return next();
  }

  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    console.log(
      'invalid x-api-token or missing auth header, rejecting request'
    );
    return res.status(403).send();
  }

  const token = authHeader.split(' ')[1];

  const jwtSecret = JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('no jwt secret');
  }

  try {
    const decoded = jwt.verify(token, jwtSecret, (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res
            .status(403)
            .json({ error: 'Token expired, please sign in again.' });
        }
      }
    });
    // check if the user exists?
  } catch (error) {
    console.log('invalid jwt supplied in auth header, rejecting request');
    return res.status(403).send();
  }

  console.log('request successfully authentciated via jwt');
  next();
};
