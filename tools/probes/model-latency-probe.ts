/**
 * ASSUMPTION UNDER TEST: which free model is fast AND reliable enough for §9's budget
 * (5 cases x ~9 calls inside 15 minutes). Discovered the hard way: gemini-3.6-flash
 * 503s repeatedly and one call took 428s. Measure, then pick.
 *
 *   npm run probe:models
 */
import { requireKey } from './gemini.js';
import { requirementsSchema } from './schemas.js';

const CANDIDATES = (
  process.env.MODELS ??
  'gemini-3.6-flash,gemini-flash-latest,gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.5-flash'
).split(',');

const JD = `Senior Backend Engineer — Remote
Requirements
- 5+ years building production backend services with Node.js
- Deep PostgreSQL experience: query tuning, migrations
- You have mentored engineers
Nice to have
- Kubernetes, Kafka`;

const call = async (model: string, thinking: 'off' | 'low') => {
  const key = requireKey();
  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `Extract requirements:\n${JD}` }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: requirementsSchema,
            thinkingConfig: thinking === 'off' ? { thinkingBudget: 0 } : { thinkingLevel: 'low' },
          },
        }),
      },
    );
    const ms = Date.now() - t0;
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ms, status: res.status, note: j?.error?.status ?? '', n: 0, tok: 0 };
    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('');
    let n = 0;
    try {
      n = JSON.parse(text).requirements?.length ?? 0;
    } catch {}
    return { ms, status: 200, note: '', n, tok: j?.usageMetadata?.totalTokenCount ?? 0 };
  } catch (e) {
    return { ms: Date.now() - t0, status: 0, note: String(e).slice(0, 40), n: 0, tok: 0 };
  }
};

const main = async () => {
  console.log('\nmodel latency probe — 3 samples each, extraction-shaped call\n');
  console.log('  model                         thinking  ok/3   median   reqs  tokens');
  const rows: { model: string; thinking: string; ok: number; med: number; n: number }[] = [];
  for (const model of CANDIDATES) {
    for (const thinking of ['off', 'low'] as const) {
      const runs = [];
      for (let i = 0; i < 3; i++) runs.push(await call(model, thinking));
      const okRuns = runs.filter((r) => r.status === 200);
      const times = okRuns.map((r) => r.ms).sort((a, b) => a - b);
      const med = times.length ? times[Math.floor(times.length / 2)]! : Infinity;
      const notes = [...new Set(runs.filter((r) => r.status !== 200).map((r) => `${r.status}${r.note ? ' ' + r.note : ''}`))];
      console.log(
        `  ${model.padEnd(29)} ${thinking.padEnd(9)} ${okRuns.length}/3  ` +
          `${(med === Infinity ? '   —' : (med / 1000).toFixed(1) + 's').padStart(7)}  ` +
          `${String(okRuns[0]?.n ?? '-').padStart(4)}  ${String(okRuns[0]?.tok ?? '-').padStart(6)}  ${notes.join(' ')}`,
      );
      rows.push({ model, thinking, ok: okRuns.length, med, n: okRuns[0]?.n ?? 0 });
    }
  }
  const viable = rows.filter((r) => r.ok === 3 && r.n > 0).sort((a, b) => a.med - b.med);
  console.log(
    viable.length
      ? `\nFASTEST RELIABLE: ${viable[0]!.model} (thinking=${viable[0]!.thinking}) at ${(viable[0]!.med / 1000).toFixed(1)}s/call` +
          `\n  → 45 calls at concurrency 2 ≈ ${((viable[0]!.med * 45) / 2 / 60000).toFixed(1)} min of the 15-min budget\n`
      : '\nNo model returned 3/3. Free tier is congested — the retry/backoff layer is doing real work.\n',
  );
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
