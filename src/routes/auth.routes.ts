import { Router } from 'express';
import type { Db } from '../services/db/index.js';
import type { Config } from '../config/index.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { asyncRoute } from '../middleware/errors.js';
import { rateLimit, validate } from '../middleware/common.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { LoginBody, RegisterBody } from '../schemas/index.js';

export function authRoutes(config: Config, db: Db): Router {
  const router = Router();
  const controller = createAuthController(config, db);

  // Credential endpoints are the ones worth limiting.
  const limit = rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.authMax });

  router.post('/register', limit, validate(RegisterBody), asyncRoute(controller.register));
  router.post('/login', limit, validate(LoginBody), asyncRoute(controller.login));
  router.post('/logout', controller.logout);
  router.get('/me', requireAuth(config, db), asyncRoute<AuthedRequest>(controller.me));

  return router;
}
