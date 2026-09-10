import type { Response } from 'express';
import type { Db } from '../services/db/index.js';
import type { JobRunner } from '../services/jobRunner.service.js';
import { ApiError } from '../middleware/errors.js';
import type { AuthedRequest } from '../middleware/auth.js';

/**
 * SSE progress. PLAN.md §6.2, §10.4.
 *
 * The stream is a VIEW of the job document, never the state itself: it replays the steps
 * already persisted before attaching a live listener, so a client that connects late (or
 * reconnects after a cold start) still sees the whole run.
 */
export function createJobsController(db: Db, runner: JobRunner) {
  return {
    async get(req: AuthedRequest, res: Response): Promise<void> {
      const job = await db.jobs.findOwned(req.user.id, req.params.id!);
      if (!job) throw ApiError.notFound('No such job.');
      res.json({ data: job });
    },

    async stream(req: AuthedRequest, res: Response): Promise<void> {
      const job = await db.jobs.findOwned(req.user.id, req.params.id!);
      if (!job) throw ApiError.notFound('No such job.');

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Nginx and some platform proxies buffer SSE without this.
        'x-accel-buffering': 'no',
      });

      const send = (event: unknown): void => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // Replay what already happened, so a late subscriber is not missing history.
      send({ type: 'status', status: job.status });
      for (const step of job.steps) send({ type: 'step', step });
      if (job.status === 'ok') send({ type: 'done', kitId: job.kitId });
      if (job.status === 'failed') send({ type: 'failed', error: job.error });

      if (job.status === 'ok' || job.status === 'failed') {
        res.end();
        return;
      }

      const unsubscribe = runner.subscribe(job.id, (event) => {
        send(event);
        const type = (event as { type?: string }).type;
        if (type === 'done' || type === 'failed') {
          unsubscribe();
          clearInterval(heartbeat);
          res.end();
        }
      });

      // Comment frames keep intermediaries from closing an idle stream.
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

      req.on('close', () => {
        unsubscribe();
        clearInterval(heartbeat);
      });
    },
  };
}

export type JobsController = ReturnType<typeof createJobsController>;
