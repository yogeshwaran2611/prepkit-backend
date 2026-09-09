import type { KitNote } from '@prepkit/schema';

/** PLAN.md §4.1 — the only place I/O is abstracted. Nothing in core reads process.env. */

export interface LlmRequest {
  system?: string;
  user: string;
  /** A FLAT per-step schema. Never the composite Kit — see §7. */
  responseSchema?: unknown;
  temperature?: number;
  maxTokens?: number;
  /** Regeneration passes a salt so the cache cannot return the same answer twice (§4.5). */
  cacheSalt?: string;
}

export interface LlmResult {
  text: string;
  model: string;
  provider: string;
  usage: { prompt: number; output: number; total: number };
  cached: boolean;
  ms: number;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResult>;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  description: string;
  text: string;
  html: string;
  bytes: number;
  ms: number;
}

export interface FetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
}

export interface FetchBudget {
  readonly maxPages: number;
  used: number;
  take(n?: number): boolean;
  remaining(): number;
}

export interface Fetcher {
  get(url: string, opts?: FetchOptions): Promise<FetchedPage>;
  /** Shared across every fetching step, so the run budget is a real cap (§4.3.1). */
  readonly budget: FetchBudget;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit?: number): Promise<SearchHit[]>;
}

export type StepName =
  | 'extract'
  | 'crawl'
  | 'hiring'
  | 'search'
  | 'brief'
  | 'questions'
  | 'coverage'
  | 'schedule';

export interface StepEvent {
  step: StepName;
  status: 'start' | 'ok' | 'skipped' | 'failed';
  detail?: string;
  elapsedMs?: number;
  at: string;
}

export interface ProgressSink {
  step(e: StepEvent): void;
}

export interface Clock {
  now(): Date;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface Deps {
  llm: LlmProvider;
  fetcher: Fetcher;
  search: SearchProvider;
  clock: Clock;
  logger: Logger;
  progress: ProgressSink;
  /** EVAL/DEV ONLY — permits loopback and non-standard ports so Appendix B works. */
  allowPrivateUrls: boolean;
}

export const noopProgress: ProgressSink = { step: () => {} };

export const consoleLogger: Logger = {
  info: (m, meta) => console.log(`[info] ${m}`, meta ?? ''),
  warn: (m, meta) => console.warn(`[warn] ${m}`, meta ?? ''),
  error: (m, meta) => console.error(`[error] ${m}`, meta ?? ''),
};

export const systemClock: Clock = { now: () => new Date() };

export function makeBudget(maxPages: number): FetchBudget {
  let used = 0;
  return {
    maxPages,
    get used() {
      return used;
    },
    set used(v: number) {
      used = v;
    },
    take(n = 1) {
      if (used + n > maxPages) return false;
      used += n;
      return true;
    },
    remaining() {
      return Math.max(0, maxPages - used);
    },
  };
}

/** A step that soft-fails returns its empty shape plus a note. Only S1 can be fatal. */
export interface SoftResult<T> {
  value: T;
  notes: KitNote[];
}
