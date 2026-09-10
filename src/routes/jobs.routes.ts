import { Router } from 'express';
import type { Db } from '../services/db/index.js';
import type { JobRunner } from '../services/jobRunner.service.js';
import type { Config } from '../config/index.js';
import { createJobsController } from '../controllers/jobs.controller.js';
import { asyncRoute } from '../middleware/errors.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export function jobsRoutes(config: Config, db: Db, runner: JobRunner): Router {
  const router = Router();
  const controller = createJobsController(db, runner);
  router.use(requireAuth(config, db));

  router.get('/:id', asyncRoute<AuthedRequest>(controller.get));
  router.get('/:id/stream', asyncRoute<AuthedRequest>(controller.stream));

  return router;
}
