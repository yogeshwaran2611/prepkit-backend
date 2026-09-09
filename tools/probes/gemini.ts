/** Minimal Gemini client for the probes. No SDK — one fetch, so the probe has no deps. */
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const KEY = process.env.GEMINI_API_KEY;

export interface Reply {
  ok: boolean;
  status: number;
  text: string;
  usage?: { prompt: number; output: number; total: number };
  ms: number;
  raw?: unknown;
}

export function requireKey(): string {
  if (!KEY) {
    console.error(
      '\nGEMINI_API_KEY is not set.\n' +
        'Get a free key (no credit card) at https://aistudio.google.com/apikey then:\n' +
        '  export GEMINI_API_KEY=...\n',
    );
    process.exit(2);
  }
  return KEY;
}

export async function generate(opts: {
  system?: string;
  user: string;
  responseSchema?: unknown;
  temperature?: number;
}): Promise<Reply> {
  const key = requireKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      responseMimeType: 'application/json',
      ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
    },
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
  };
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const json = (await res.json()) as any;
  if (!res.ok) {
    return { ok: false, status: res.status, text: JSON.stringify(json?.error ?? json), ms, raw: json };
  }
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const u = json?.usageMetadata;
  return {
    ok: true,
    status: res.status,
    text,
    ms,
    usage: u
      ? { prompt: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, total: u.totalTokenCount ?? 0 }
      : undefined,
    raw: json,
  };
}

export const MODEL_NAME = MODEL;
