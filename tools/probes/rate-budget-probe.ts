/**
 * ASSUMPTION UNDER TEST (PLAN.md §4.5 / §9):
 *   "5 cases x ~9 calls completes inside the 15-minute batch budget on the free tier,
 *    including any retries rate limits force."
 * Simulates the real call pattern at the real concurrency and reports wall clock,
 * tokens/minute actually observed, and every 429 encountered.
 *
 *   npm run probe:budget            # 45 calls, concurrency 2 (the §9 shape)
 *   CASES=2 npm run probe:budget    # smaller sample, fewer tokens burned
 */
import { generate, MODEL_NAME } from './gemini.js';
import { ALL } from './schemas.js';

const CASES = Number(process.env.CASES ?? 5);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 2);
const BUDGET_MS = 15 * 60 * 1000;

// The per-case call pattern from PLAN.md §4.5: extract, hiring, brief, 4 categories, flashcards, 1 gap pass.
const CALLS_PER_CASE: (keyof typeof ALL)[] = [
  'requirements',
  'hiring',
  'brief',
  'questions',
  'questions',
  'questions',
  'questions',
  'flashcards',
  'questions',
];

const PROMPT: Record<keyof typeof ALL, string> = {
  requirements:
    'Extract the role and requirements:\n\nSenior Backend Engineer, Remote.\nRequired: 5+ years Node.js, Postgres, mentoring.\nNice: Kubernetes.',
  questions: 'Generate 3 interview questions for requirement r1 = "5+ years Node.js". Use requirement_ids: ["r1"].',
  brief: 'Summarise: "Acme builds logistics software for ports."',
  hiring: 'Extract stages from: "Intro call, take-home, system design, then a values interview."',
  flashcards: 'Make 3 flashcards for r1 = "5+ years Node.js". Use requirement_ids: ["r1"].',
};

interface Stat { ms: number; tok: number; status: number; retries: number }

const withRetry = async (kind: keyof typeof ALL): Promise<Stat> => {
  let retries = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await generate({ user: PROMPT[kind], responseSchema: ALL[kind] });
    if (r.ok) return { ms: r.ms, tok: r.usage?.total ?? 0, status: 200, retries };
    if (r.status === 429 || r.status >= 500) {
      retries++;
      const wait = Math.min(2 ** attempt * 1000 + Math.random() * 500, 30_000);
      console.log(`     429/5xx on ${kind} — backing off ${Math.round(wait)}ms (attempt ${attempt + 1})`);
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    return { ms: r.ms, tok: 0, status: r.status, retries };
  }
  return { ms: 0, tok: 0, status: 429, retries };
};

const main = async () => {
  const queue: (keyof typeof ALL)[] = [];
  for (let c = 0; c < CASES; c++) queue.push(...CALLS_PER_CASE);
  console.log(
    `\nrate/budget probe — model ${MODEL_NAME}, ${CASES} cases x ${CALLS_PER_CASE.length} calls ` +
      `= ${queue.length} calls at concurrency ${CONCURRENCY}\n`,
  );

  const stats: Stat[] = [];
  const t0 = Date.now();
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const i = next++;
      const kind = queue[i]!;
      const s = await withRetry(kind);
      stats.push(s);
      const done = stats.length;
      if (done % 5 === 0 || done === queue.length)
        console.log(`  ${String(done).padStart(3)}/${queue.length} calls  ${Math.round((Date.now() - t0) / 1000)}s elapsed`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const wall = Date.now() - t0;
  const tokens = stats.reduce((a, s) => a + s.tok, 0);
  const errors = stats.filter((s) => s.status !== 200);
  const retries = stats.reduce((a, s) => a + s.retries, 0);
  const perCase = wall / CASES;

  console.log(`\n  wall clock        ${(wall / 1000).toFixed(1)}s  (budget ${BUDGET_MS / 1000}s for 5 cases)`);
  console.log(`  per case          ${(perCase / 1000).toFixed(1)}s`);
  console.log(`  tokens total      ${tokens}`);
  console.log(`  tokens/min obs.   ${Math.round(tokens / (wall / 60000))}`);
  console.log(`  429/5xx retries   ${retries}`);
  console.log(`  hard failures     ${errors.length}`);

  const projected = perCase * 5;
  const pass = projected < BUDGET_MS && errors.length === 0;
  console.log(
    pass
      ? `\nPASS — 5 cases project to ${(projected / 1000).toFixed(0)}s, inside the 15-minute budget.\n`
      : `\nFAIL — 5 cases project to ${(projected / 1000).toFixed(0)}s or hard-failed. ` +
        `Lower concurrency, shrink prompts, or size the token bucket down.\n`,
  );
  console.log('  Set LLM_TPM/LLM_RPM in .env from the observed tokens/min, not from a guess.\n');
  process.exit(pass ? 0 : 1);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
