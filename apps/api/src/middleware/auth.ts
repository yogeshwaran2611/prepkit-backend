import { hash, verify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import type { Db, UserRecord } from '@prepkit/db';
import type { CookieConfig, Config } from '../config.js';
import { ApiError } from './errors.js';

/**
 * Auth. PLAN.md §8. Deliberately minimal: the brief says email verification, password reset
 * and role hierarchies are out of scope and unscored.
 */

export interface AuthedRequest extends Request {
  user: { id: string; email: string };
  requestId?: string;
}

const ISSUER = 'prepkit';

export async function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

export async function createSessionToken(user: UserRecord, config: Config): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(new Date(Date.now() + config.cookie.maxAgeMs))
    .sign(new TextEncoder().encode(config.jwtSecret));
}

async function readSessionToken(token: string, config: Config): Promise<{ id: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.jwtSecret), { issuer: ISSUER });
    if (!payload.sub) return null;
    return { id: payload.sub, email: String(payload.email ?? '') };
  } catch {
    // Expired or tampered — both are "sign in again", not a 500.
    return null;
  }
}

/**
 * THE ONLY place cookie flags are set. Every route uses these two functions, so a route
 * cannot accidentally ship a cookie the browser will refuse to send.
 */
export function setSessionCookie(res: Response, token: string, cookie: CookieConfig): void {
  res.cookie(cookie.name, token, {
    httpOnly: true,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    ...(cookie.domain ? { domain: cookie.domain } : {}),
    maxAge: cookie.maxAgeMs,
    path: '/',
  });
}

export function clearSessionCookie(res: Response, cookie: CookieConfig): void {
  res.clearCookie(cookie.name, {
    httpOnly: true,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    ...(cookie.domain ? { domain: cookie.domain } : {}),
    path: '/',
  });
}

/** Rejects unauthenticated requests. A missing OR expired session both yield 401. */
export function requireAuth(config: Config, db: Db) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = (req.cookies as Record<string, string> | undefined)?.[config.cookie.name];
    if (!token) {
      next(ApiError.unauthorized());
      return;
    }
    void (async () => {
      const session = await readSessionToken(token, config);
      if (!session) {
        clearSessionCookie(res, config.cookie);
        next(ApiError.sessionExpired());
        return;
      }
      // The token can outlive the account, so confirm the user still exists.
      const user = await db.users.findById(session.id);
      if (!user) {
        clearSessionCookie(res, config.cookie);
        next(ApiError.sessionExpired());
        return;
      }
      (req as AuthedRequest).user = { id: user.id, email: user.email };
      next();
    })().catch(next);
  };
}

/**
 * CSRF guard for cross-site mode. SameSite=None gives up the browser's own CSRF protection,
 * so mutating requests must carry an Origin from the allowlist. Cheap, no token round-trip.
 */
export function requireTrustedOrigin(config: Config) {
  const allowed = new Set(config.corsOrigins);
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    if (config.cookie.mode !== 'cross-site') {
      next();
      return;
    }
    const origin = req.get('origin');
    if (!origin || !allowed.has(origin)) {
      next(new ApiError(403, 'BAD_ORIGIN', 'This request did not come from an allowed origin.'));
      return;
    }
    next();
  };
}
