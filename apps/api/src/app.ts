import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import type { Db } from '@prepkit/db';
import {
  RateLimitedQueue,
  makeBudget,
  systemClock,
  type Deps,
  type StepEvent,
} from '@prepkit/core';
import { FileCache, GeminiProvider, HttpFetcher, defaultSearch } from '@prepkit/adapters';
import type { Config } from './config.js';
import { accessLog, requestId, securityHeaders } from './middleware/common.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { requireTrustedOrigin } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { kitsRouter } from './routes/kits.js';
import { jobsRouter } from './routes/jobs.js';
import { JobRunner } from './services/job-runner.js';

export interface App {
  express: Express;
  runner: JobRunner;
}

export function createApp(config: Config, db: Db): App {
  const app = express();
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(securityHeaders);
  app.use(accessLog);

  // CORS with credentials REQUIRES an explicit origin echo — `*` is illegal alongside
  // credentials and fails silently in the browser (§8).
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true); // curl, server-to-server, same-origin
        cb(null, config.corsOrigins.includes(origin) ? origin : false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(requireTrustedOrigin(config));

  // One shared LLM queue across every job, so the token bucket is a real global limit.
  const llmQueue = new RateLimitedQueue({
    concurrency: config.llm.concurrency,
    tokensPerMinute: config.llm.tpm,
    requestsPerMinute: config.llm.rpm,
  });
  const cache = new FileCache('.cache');

  const buildDeps = (progress: (e: StepEvent) => void): Deps => ({
    llm: new GeminiProvider({
      apiKey: config.gemini.apiKey,
      ...(config.gemini.model ? { model: config.gemini.model } : {}),
      cache: { get: (k) => db.cache.get(k), set: (k, v) => db.cache.set(k, v) },
      queue: llmQueue,
      onRetry: ({ attempt, waitMs, error }) =>
        console.warn(`llm retry ${attempt} in ${Math.round(waitMs)}ms: ${(error as Error)?.message ?? error}`),
    }),
    fetcher: new HttpFetcher({
      allowPrivate: config.allowPrivateUrls,
      maxPages: config.fetchMaxPages,
      cache,
    }),
    search: defaultSearch({
      cache,
      ...(config.braveApiKey ? { braveApiKey: config.braveApiKey } : {}),
      onFallback: (from, e) => console.warn(`search provider ${from} unavailable: ${(e as Error)?.message ?? e}`),
    }),
    clock: systemClock,
    logger: {
      info: (m, meta) => console.log(`[pipeline] ${m}`, meta ?? ''),
      warn: (m, meta) => console.warn(`[pipeline] ${m}`, meta ?? ''),
      error: (m, meta) => console.error(`[pipeline] ${m}`, meta ?? ''),
    },
    progress: { step: progress },
    allowPrivateUrls: config.allowPrivateUrls,
  });

  const runner = new JobRunner({
    db,
    buildDeps,
    concurrency: config.jobConcurrency,
    leaseMs: config.jobLeaseMs,
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      data: {
        ok: true,
        store: db.kind,
        model: config.gemini.model ?? 'gemini-3.1-flash-lite',
        hasLlmKey: Boolean(config.gemini.apiKey),
        cookieMode: config.cookie.mode,
      },
    });
  });

  app.use('/api/auth', authRouter(config, db));
  app.use('/api/kits', kitsRouter(config, db, runner));
  app.use('/api/jobs', jobsRouter(config, db, runner));

  app.use(notFoundHandler);
  app.use(errorHandler);

  void makeBudget;
  return { express: app, runner };
}
