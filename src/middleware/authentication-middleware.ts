import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/config';

export const authenticateMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const publicRoutes = ['/api/login', '/health'];

  if (publicRoutes.includes(req.path)) {
    return next();
  }

  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(403).send();
  }

  const token = authHeader.split(' ')[1];

  const jwtSecret = JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('no jwt secret');
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    // check if the user exists?
  } catch (error) {
    // if it doesn't send 403
    return res.status(403).send();
  }

  next();
};
