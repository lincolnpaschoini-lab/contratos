import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../config/logger';
import { env } from '../../config/env';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 400,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  const correlationId = res.locals.correlationId as string | undefined;

  if (err instanceof ZodError) {
    logger.warn('Erro de validação', { correlationId, path: req.path, errors: err.flatten() });
    return res.status(422).json({
      success: false,
      message: 'Dados inválidos.',
      errors: err.flatten().fieldErrors,
    });
  }

  if (err instanceof AppError) {
    logger.warn(`AppError: ${err.message}`, { correlationId, statusCode: err.statusCode, path: req.path });
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
    });
  }

  // Erros inesperados
  logger.error('Erro interno não tratado', {
    correlationId,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  const message = env.NODE_ENV === 'production' ? 'Erro interno do servidor.' : err.message;

  res.status(500).json({
    success: false,
    message,
    ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}
