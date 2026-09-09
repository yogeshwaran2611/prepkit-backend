/**
 * Minimal Gemini client for the probes — one fetch, no SDK.
 *
 * Two things learned from the live API on 2026-09-09 and encoded here:
 *  - `gemini-2.5-flash` returns 404 "no longer available to new users"; the API itself
 *    points at `gemini-3.6-flash`. Never hard-code a model that a doc page recommended.
 *  - This model 503s ("high demand") intermittently and is a *thinking* model, so a
 *    one-word reply can take 18s. Both are handled here, not wished away.
 */
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';
const KEY = process.env.GEMINI_API_KEY;

export interface Reply {
  ok: boolean;
  status: number;
  text: string;
  usage?: { prompt: number; output: number; thoughts: number; total: number };
  ms: number;
  attempts: number;
  raw?: unknown;
}

export function requireKey(): string {
  if (!KEY) {
    console.error(
      '\nGEMINI_API_KEY is not set.\n' +
        'Free key (no credit card): https://aistudio.google.com/apikey\n' +
        'Then put it in .env (already gitignored) and run via `npm run probe:*`.\n',
    );
    process.exit(2);
  }
  return KEY;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generate(opts: {
  system?: string;
  user: string;
  responseSchema?: unknown;
  temperature?: number;
  /** 'low' keeps latency sane; thinking is why a trivial reply can cost 18s. */
  thinking?: 'low' | 'high' | 'off';
  maxAttempts?: number;
}): Promise<Reply> {
  const key = requireKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const thinking = opts.thinking ?? 'low';

  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.2,
    responseMimeType: 'application/json',
    ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
    ...(thinking === 'off'
      ? { thinkingConfig: { thinkingBudget: 0 } }
      : { thinkingConfig: { thinkingLevel: thinking } }),
  };
  const body = {
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    generationConfig,
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
  };

  const maxAttempts = opts.maxAttempts ?? 5;
  const t0 = Date.now();
  let lastStatus = 0;
  let lastText = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      lastStatus = 0;
      lastText = String(e);
      if (attempt < maxAttempts) {
        await sleep(backoff(attempt, undefined));
        continue;
      }
      break;
    }

    const json = (await res.json().catch(() => ({}))) as any;
    if (res.ok) {
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p: any) => p?.text ?? '').join('');
      const u = json?.usageMetadata ?? {};
      return {
        ok: true,
        status: res.status,
        text,
        ms: Date.now() - t0,
        attempts: attempt,
        usage: {
          prompt: u.promptTokenCount ?? 0,
          output: u.candidatesTokenCount ?? 0,
          thoughts: u.thoughtsTokenCount ?? 0,
          total: u.totalTokenCount ?? 0,
        },
        raw: json,
      };
    }

    lastStatus = res.status;
    lastText = JSON.stringify(json?.error ?? json);
    if (!RETRYABLE.has(res.status) || attempt === maxAttempts) break;
    const wait = backoff(attempt, res.headers.get('retry-after'));
    process.stderr.write(
      `    ${res.status} ${json?.error?.status ?? ''} — retry ${attempt}/${maxAttempts - 1} in ${Math.round(wait)}ms\n`,
    );
    await sleep(wait);
  }

  return { ok: false, status: lastStatus, text: lastText, ms: Date.now() - t0, attempts: maxAttempts };
}

/** Exponential backoff with jitter, honouring Retry-After when the server sends one. */
function backoff(attempt: number, retryAfter: string | null | undefined): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000);
  }
  return Math.min(2 ** attempt * 1000 + Math.random() * 750, 45_000);
}

export const MODEL_NAME = MODEL;
