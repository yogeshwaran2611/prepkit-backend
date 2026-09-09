import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { ApiError } from './errors.js';

/** Correlation id on every request and every error response. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();
  (req as { requestId?: string }).requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

/** Structured access log. No cookies, no bodies — nothing that could carry a secret. */
export function accessLog(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on('finish', () => {
    const id = (req as { requestId?: string }).requestId ?? '-';
    console.log(`[${id}] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
}

/** Validates body/query/params against a Zod schema from @prepkit/schema. */
export const validate =
  <T>(schema: ZodType<T>, source: 'body' | 'query' | 'params' = 'body') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      next(
        ApiError.badRequest(
          'That request was not valid.',
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      );
      return;
    }
    (req as unknown as Record<string, unknown>)[source] = parsed.data;
    next();
  };

/**
 * Fixed-window rate limiter, in memory.
 * ponytail: in-process counters, correct for a single instance. A shared store is only
 * needed once this runs on more than one machine.
 */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = opts.key?.(req) ?? req.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    entry.count++;
    if (entry.count > opts.max) {
      res.setHeader('retry-after', Math.ceil((entry.resetAt - now) / 1000));
      next(ApiError.tooMany());
      return;
    }
    next();
  };
}

/** Minimal security headers. Enough for a JSON API; no helmet dependency needed. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cross-origin-resource-policy', 'same-site');
  res.removeHeader('x-powered-by');
  next();
}
