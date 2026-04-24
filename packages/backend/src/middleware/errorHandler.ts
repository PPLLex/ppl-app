import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError';
import { captureError } from '../utils/sentry';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof ApiError) {
    // Client errors (4xx) aren't sent to Sentry — they're expected user-
    // input failures and would swamp the error stream with false positives.
    // Only surface 5xx ApiErrors.
    if (err.statusCode >= 500) {
      captureError(err, {
        userId: req.user?.userId,
        tags: { statusCode: String(err.statusCode), path: req.path },
      });
    }
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  console.error('Unhandled error:', err);
  captureError(err, {
    userId: req.user?.userId,
    tags: { source: 'unhandledError', path: req.path, method: req.method },
  });
  return res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
};
