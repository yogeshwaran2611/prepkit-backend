/**
 * PLAN.md §4.5 — "free tiers limit tokens per minute, not just requests, and that limit is
 * easy to hit. A pipeline that falls over the first time a provider says 'slow down' is the
 * most common way to lose points here."
 *
 * So: reserve estimated tokens BEFORE dispatch and wait if the bucket is dry. This handles
 * the limit rather than reacting to the 429 it would otherwise cause.
 *
 * No p-queue / p-retry dependency: a token bucket and a serial queue are ~60 lines, and
 * fewer dependencies is fewer things to justify in the README.
 */

export interface QueueOptions {
  concurrency?: number;
  /** Tokens per minute the bucket may spend. 0 disables token accounting. */
  tokensPerMinute?: number;
  /** Requests per minute. 0 disables request accounting. */
  requestsPerMinute?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RateLimitedQueue {
  private readonly concurrency: number;
  private readonly tpm: number;
  private readonly rpm: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private tokenBudget: number;
  private requestBudget: number;
  private windowStart: number;
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(opts: QueueOptions = {}) {
    this.concurrency = Math.max(1, opts.concurrency ?? 2);
    this.tpm = Math.max(0, opts.tokensPerMinute ?? 0);
    this.rpm = Math.max(0, opts.requestsPerMinute ?? 0);
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? defaultSleep;
    this.tokenBudget = this.tpm;
    this.requestBudget = this.rpm;
    this.windowStart = this.now();
  }

  /** Runs `fn` once a slot and enough budget are free. `estimatedTokens` reserves ahead. */
  async run<T>(fn: () => Promise<T>, estimatedTokens = 0): Promise<T> {
    await this.acquireSlot();
    try {
      await this.acquireBudget(estimatedTokens);
      return await fn();
    } finally {
      this.releaseSlot();
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }

  private releaseSlot(): void {
    this.active--;
    this.waiters.shift()?.();
  }

  private async acquireBudget(tokens: number): Promise<void> {
    if (!this.tpm && !this.rpm) return;
    for (;;) {
      this.refillIfWindowElapsed();
      const tokensOk = !this.tpm || this.tokenBudget >= Math.min(tokens, this.tpm);
      const requestsOk = !this.rpm || this.requestBudget >= 1;
      if (tokensOk && requestsOk) {
        if (this.tpm) this.tokenBudget -= tokens;
        if (this.rpm) this.requestBudget -= 1;
        return;
      }
      const waitMs = Math.max(50, 60_000 - (this.now() - this.windowStart));
      await this.sleep(waitMs);
    }
  }

  private refillIfWindowElapsed(): void {
    if (this.now() - this.windowStart >= 60_000) {
      this.windowStart = this.now();
      this.tokenBudget = this.tpm;
      this.requestBudget = this.rpm;
    }
  }
}

/** ~4 characters per token is close enough to reserve against a per-minute budget. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; waitMs: number; error: unknown }) => void;
}

export interface RetryableError {
  status?: number;
  retryAfterMs?: number;
}

/** Retryable: 429, 408, 5xx, and transport errors. NEVER a 4xx schema error. */
export function isRetryable(e: unknown): boolean {
  const status = (e as RetryableError)?.status;
  if (typeof status === 'number') return status === 429 || status === 408 || status >= 500;
  // No status at all means a transport error (DNS, reset, timeout) — worth another try.
  return true;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const baseMs = opts.baseMs ?? 1_000;
  const maxMs = opts.maxMs ?? 45_000;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === attempts || !isRetryable(e)) throw e;
      const retryAfter = (e as RetryableError)?.retryAfterMs;
      const waitMs = retryAfter ?? Math.min(2 ** attempt * baseMs + random() * 750, maxMs);
      opts.onRetry?.({ attempt, waitMs, error: e });
      await sleep(waitMs);
    }
  }
  throw lastError;
}
