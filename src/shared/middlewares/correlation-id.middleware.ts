import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const correlationId = (req.headers['x-correlation-id'] as string) ?? uuidv4();
  res.locals.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);
  next();
}
