import { Router } from 'express';
import type { Db } from '@prepkit/db';
import { LoginBody, RegisterBody } from '@prepkit/schema';
import type { Config } from '../config.js';
import { ApiError, asyncRoute } from '../middleware/errors.js';
import { rateLimit, validate } from '../middleware/common.js';
import {
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  requireAuth,
  setSessionCookie,
  verifyPassword,
  type AuthedRequest,
} from '../middleware/auth.js';

export function authRouter(config: Config, db: Db): Router {
  const router = Router();

  // Credential endpoints are the ones worth limiting: 10 attempts per minute per IP.
  const limit = rateLimit({ windowMs: 60_000, max: 10 });

  router.post(
    '/register',
    limit,
    validate(RegisterBody),
    asyncRoute(async (req, res) => {
      const { email, password } = req.body as RegisterBody;
      const existing = await db.users.findByEmail(email);
      if (existing) {
        // Deliberately explicit: this endpoint is not an enumeration oracle worth protecting
        // when the sign-up form must tell an honest user their account already exists.
        throw ApiError.conflict('EMAIL_TAKEN', 'An account with that email already exists. Sign in instead.');
      }
      const user = await db.users.create({ email, passwordHash: await hashPassword(password) });
      setSessionCookie(res, await createSessionToken(user, config), config.cookie);
      res.status(201).json({ data: { id: user.id, email: user.email } });
    }),
  );

  router.post(
    '/login',
    limit,
    validate(LoginBody),
    asyncRoute(async (req, res) => {
      const { email, password } = req.body as LoginBody;
      const user = await db.users.findByEmail(email);
      // Same message and roughly the same work either way, so timing does not leak which
      // half was wrong.
      const ok = user ? await verifyPassword(user.passwordHash, password) : await fakeVerify(password);
      if (!user || !ok) throw ApiError.unauthorized('That email and password do not match.');

      setSessionCookie(res, await createSessionToken(user, config), config.cookie);
      res.json({ data: { id: user.id, email: user.email } });
    }),
  );

  router.post('/logout', (_req, res) => {
    clearSessionCookie(res, config.cookie);
    res.json({ data: { ok: true } });
  });

  router.get(
    '/me',
    requireAuth(config, db),
    asyncRoute<AuthedRequest>(async (req, res) => {
      res.json({ data: { id: req.user.id, email: req.user.email } });
    }),
  );

  return router;
}

/** Burns comparable time when the email does not exist. */
async function fakeVerify(password: string): Promise<boolean> {
  await hashPassword(password);
  return false;
}
