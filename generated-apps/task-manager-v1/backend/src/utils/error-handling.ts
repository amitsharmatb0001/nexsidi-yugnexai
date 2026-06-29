import { Request, Response, NextFunction } from 'express';
import { ApiErrorResponse } from '../types';
import { logger } from './logger';

// Mapping of custom error codes to status codes and messages
const ERROR_MAP: Record<string, Omit<ApiErrorResponse, 'code'>> = {
  VALIDATION_ERROR: { status: 422, message: 'Invalid request data' },
  UNAUTHORIZED: { status: 401, message: 'Unauthorized' },
  FORBIDDEN: { status: 403, message: 'Forbidden' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  DB_ERROR: { status: 500, message: 'Database error' },
};

export function formatError(err: Error | any): ApiErrorResponse {
  const knownError = ERROR_MAP[err.code] || UNKNOWN_ERROR;
  
  // Log the full error details internally
  logger.error(`Error processing request: ${err.message}`, err);

  return {
    status: knownError.status,
    message: err.message || knownError.message,
    code: err.code || 'INTERNAL_ERROR',
  };
}

const UNKNOWN_ERROR = {
  status: 500,
  message: 'Internal Server Error',
};

// Middleware wrapper to handle async errors automatically
export function handleAsyncWrapper(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

// Global error handler middleware
export function errorHandler(
  err: Error | any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const errorResponse = formatError(err);
  
  res.status(errorResponse.status).json(errorResponse);
}
