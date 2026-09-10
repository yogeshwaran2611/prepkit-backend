import type { NextFunction, Request, Response } from 'express';

/**
 * One error shape for the whole API: { error: { code, message, details? } }.
 * "Handle errors gracefully and return useful, structured messages to the interface."
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, 'INVALID_INPUT', message, details);
  }
  static unauthorized(message = 'You need to sign in to do that.') {
    return new ApiError(401, 'UNAUTHENTICATED', message);
  }
  static sessionExpired() {
    return new ApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  }
  /** Cross-user access returns 404, not 403: a 403 confirms the resource exists. */
  static notFound(message = 'Not found.') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(code: string, message: string, details?: unknown) {
    return new ApiError(409, code, message, details);
  }
  static tooMany(message = 'Too many requests. Please slow down.') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }
  static internal(message = 'Something went wrong on our side.') {
    return new ApiError(500, 'INTERNAL', message);
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as { requestId?: string }).requestId;

  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}), requestId },
    });
    return;
  }

  // Unexpected errors are logged in full but never leaked to the client.
  console.error(`[${requestId ?? '-'}] unhandled error`, err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong on our side.', requestId },
  });
}

/** Wraps an async handler so a rejected promise reaches the error handler. */
export const asyncRoute =
  <T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    void fn(req as T, res, next).catch(next);
  };
