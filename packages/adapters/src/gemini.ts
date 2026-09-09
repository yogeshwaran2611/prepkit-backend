import type { CacheStore, LlmProvider, LlmRequest, LlmResult } from '@prepkit/core';
import { RateLimitedQueue, cacheKey, estimateTokens, withRetry } from '@prepkit/core';

/**
 * Gemini provider. PLAN.md §7.
 *
 * Model choice is EVIDENCE, not preference — measured by `npm run probe:models` against the
 * live free tier on 2026-09-09:
 *   gemini-2.5-flash      404: "no longer available to new users"
 *   gemini-3.6-flash      29.3s median, 2/3 succeeded (thinking model, frequent 503s)
 *   gemini-flash-latest    4.1s median, 1/3 succeeded (heavily congested)
 *   gemini-3.1-flash-lite  8.2s median, 3/3 succeeded  <-- chosen
 * At 8.2s/call, 45 calls at concurrency 2 is ~3.1 min of the 15-minute batch budget.
 *
 * Also learned the hard way: `thinkingConfig.thinkingBudget: 0` is rejected with 400 on
 * some models while `thinkingLevel` is accepted, so the request degrades instead of failing.
 */

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  cache?: CacheStore;
  queue?: RateLimitedQueue;
  /** 'low' keeps latency sane on thinking models. */
  thinking?: 'low' | 'high';
  baseUrl?: string;
  timeoutMs?: number;
  onRetry?: (info: { attempt: number; waitMs: number; error: unknown }) => void;
}

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly model: string;
  private readonly queue: RateLimitedQueue;
  private readonly cache: CacheStore | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private thinkingSupported = true;

  constructor(private readonly opts: GeminiOptions) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.queue = opts.queue ?? new RateLimitedQueue({ concurrency: 2 });
    this.cache = opts.cache;
    this.baseUrl = opts.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const started = Date.now();
    const key = cacheKey({ model: this.model, ...(req.system !== undefined ? { system: req.system } : {}), user: req.user, ...(req.cacheSalt !== undefined ? { salt: req.cacheSalt } : {}) });

    // A regeneration passes a cacheSalt, which changes the key — so it can never be served
    // the identical section back. See PLAN.md §4.5.
    if (this.cache && !req.cacheSalt) {
      const hit = await this.cache.get(key);
      if (hit !== undefined) {
        return {
          text: hit,
          model: this.model,
          provider: this.name,
          usage: { prompt: 0, output: 0, total: 0 },
          cached: true,
          ms: Date.now() - started,
        };
      }
    }

    const estimated = estimateTokens((req.system ?? '') + req.user) + (req.maxTokens ?? 1_200);
    const text = await this.queue.run(
      () =>
        withRetry(() => this.call(req), {
          attempts: 5,
          ...(this.opts.onRetry ? { onRetry: this.opts.onRetry } : {}),
        }),
      estimated,
    );

    if (this.cache) await this.cache.set(key, text.text);
    return { ...text, cached: false, ms: Date.now() - started };
  }

  private async call(req: LlmRequest): Promise<Omit<LlmResult, 'cached' | 'ms'>> {
    const generationConfig: Record<string, unknown> = {
      temperature: req.temperature ?? 0.2,
      responseMimeType: 'application/json',
      ...(req.responseSchema ? { responseSchema: req.responseSchema } : {}),
      ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
      ...(this.thinkingSupported ? { thinkingConfig: { thinkingLevel: this.opts.thinking ?? 'low' } } : {}),
    };

    const res = await fetch(`${this.baseUrl}/models/${this.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.opts.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig,
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const json = (await res.json().catch(() => ({}))) as GeminiResponse;

    if (!res.ok) {
      const message = json.error?.message ?? `HTTP ${res.status}`;
      // Some models reject thinkingConfig outright. Drop it and let the retry succeed
      // rather than failing the whole run over a per-model quirk.
      if (res.status === 400 && /thinking/i.test(message) && this.thinkingSupported) {
        this.thinkingSupported = false;
        throw new HttpError(`retrying without thinkingConfig: ${message}`, 503);
      }
      const retryAfter = res.headers.get('retry-after');
      throw new HttpError(
        message,
        res.status,
        retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1_000 : undefined,
      );
    }

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('');
    if (!text.trim()) throw new HttpError('the model returned an empty response', 502);

    const u = json.usageMetadata ?? {};
    return {
      text,
      model: json.modelVersion ?? this.model,
      provider: this.name,
      usage: {
        prompt: u.promptTokenCount ?? 0,
        output: u.candidatesTokenCount ?? 0,
        total: u.totalTokenCount ?? 0,
      },
    };
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
  error?: { message?: string; status?: string; code?: number };
}

export const isRetryableStatus = (status: number): boolean => RETRYABLE.has(status);

/**
 * Provider chain: try each in order, fail over on a retryable exhaustion (repeated 429,
 * a daily cap, or an outage) and record which provider actually answered.
 */
export class ProviderChain implements LlmProvider {
  readonly name = 'chain';
  constructor(
    private readonly providers: LlmProvider[],
    private readonly onFailover?: (from: string, to: string, error: unknown) => void,
  ) {
    if (!providers.length) throw new Error('ProviderChain needs at least one provider');
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i]!;
      try {
        return await provider.complete(req);
      } catch (e) {
        lastError = e;
        const next = this.providers[i + 1];
        if (next) this.onFailover?.(provider.name, next.name, e);
      }
    }
    throw lastError;
  }
}
