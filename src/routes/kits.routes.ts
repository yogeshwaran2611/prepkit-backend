import { Router } from 'express';
import type { Db } from '../services/db/index.js';
import type { JobRunner } from '../services/jobRunner.service.js';
import type { Config } from '../config/index.js';
import { createKitsController } from '../controllers/kits.controller.js';
import { asyncRoute } from '../middleware/errors.js';
import { rateLimit, validate } from '../middleware/common.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { AddItemBody, BatchKitBody, CreateKitBody, PatchItemBody, PracticeBody, RegenerateBody, ReorderBody } from '../schemas/index.js';

/** Only endpoint definitions here — every handler's logic lives in the controller. */
export function kitsRoutes(config: Config, db: Db, runner: JobRunner): Router {
  const router = Router();
  const controller = createKitsController(db, runner);
  router.use(requireAuth(config, db));

  /** Generation is the expensive path, so it gets its own limiter. */
  const generateLimit = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.generateMax,
    key: (req) => (req as AuthedRequest).user?.id ?? req.ip ?? 'anon',
  });

  router.get('/', asyncRoute<AuthedRequest>(controller.list));
  router.get('/:id', asyncRoute<AuthedRequest>(controller.get));

  router.post('/', generateLimit, validate(CreateKitBody), asyncRoute<AuthedRequest>(controller.create));
  router.post('/batch', generateLimit, validate(BatchKitBody), asyncRoute<AuthedRequest>(controller.createBatch));
  router.delete('/:id', asyncRoute<AuthedRequest>(controller.remove));

  router.patch('/:id/items/:itemId', validate(PatchItemBody), asyncRoute<AuthedRequest>(controller.patchItem));
  router.patch('/:id/order', validate(ReorderBody), asyncRoute<AuthedRequest>(controller.reorder));
  router.post('/:id/items', validate(AddItemBody), asyncRoute<AuthedRequest>(controller.addItem));
  router.delete('/:id/items/:itemId', asyncRoute<AuthedRequest>(controller.deleteItem));

  router.post('/:id/regenerate', generateLimit, validate(RegenerateBody), asyncRoute<AuthedRequest>(controller.regenerate));

  router.post('/:id/practice', validate(PracticeBody), asyncRoute<AuthedRequest>(controller.recordPractice));
  router.get('/:id/practice', asyncRoute<AuthedRequest>(controller.listPractice));
  router.get('/:id/weak-spots', asyncRoute<AuthedRequest>(controller.weakSpots));

  return router;
}
