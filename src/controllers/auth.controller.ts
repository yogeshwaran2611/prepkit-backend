import type { Request, Response } from 'express';
import { LoginBody, RegisterBody } from '../schemas/index.js';
import type { Config } from '../config/index.js';
import type { Db } from '../services/db/index.js';
import { ApiError } from '../middleware/errors.js';
import {
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  setSessionCookie,
  verifyPassword,
  type AuthedRequest,
} from '../middleware/auth.js';

export function createAuthController(config: Config, db: Db) {
  return {
    async register(req: Request, res: Response): Promise<void> {
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
    },

    async login(req: Request, res: Response): Promise<void> {
      const { email, password } = req.body as LoginBody;
      const user = await db.users.findByEmail(email);
      // Same message and roughly the same work either way, so timing does not leak which
      // half was wrong.
      const ok = user ? await verifyPassword(user.passwordHash, password) : await fakeVerify(password);
      if (!user || !ok) throw ApiError.unauthorized('That email and password do not match.');

      setSessionCookie(res, await createSessionToken(user, config), config.cookie);
      res.json({ data: { id: user.id, email: user.email } });
    },

    logout(_req: Request, res: Response): void {
      clearSessionCookie(res, config.cookie);
      res.json({ data: { ok: true } });
    },

    async me(req: AuthedRequest, res: Response): Promise<void> {
      res.json({ data: { id: req.user.id, email: req.user.email } });
    },
  };
}

export type AuthController = ReturnType<typeof createAuthController>;

/** Burns comparable time when the email does not exist. */
async function fakeVerify(password: string): Promise<boolean> {
  await hashPassword(password);
  return false;
}
