/**
 * ASSUMPTION UNDER TEST (PLAN.md §7):
 *   "Gemini's responseSchema accepts our flattened per-step schemas."
 * If it does not, the pipeline 400s on every LLM call and the plan needs a different
 * JSON strategy. Cheaper to find out now than on Day 2.
 *
 *   npm run probe:schema
 */
import { generate, MODEL_NAME } from './gemini.js';
import { ALL } from './schemas.js';

const PROMPTS: Record<keyof typeof ALL, string> = {
  requirements:
    'Extract the role and its requirements from this posting:\n\nSenior Backend Engineer, Remote (EU).\nRequired: 5+ years Node.js, strong Postgres, mentoring juniors.\nNice to have: Kubernetes, Kafka.',
  questions:
    'Generate 2 technical interview questions for requirement r1 = "5+ years Node.js". Use requirement_ids: ["r1"].',
  brief: 'Summarise this company from the text: "Acme builds logistics software for ports."',
  hiring:
    'Extract the hiring process from: "We run a 45-minute intro, a take-home, then a system design round."',
  flashcards: 'Make 2 flashcards for requirement r1 = "5+ years Node.js". Use requirement_ids: ["r1"].',
};

const main = async () => {
  console.log(`\nresponseSchema probe — model: ${MODEL_NAME}\n`);
  let failed = 0;
  for (const name of Object.keys(ALL) as (keyof typeof ALL)[]) {
    const r = await generate({ user: PROMPTS[name], responseSchema: ALL[name] });
    if (!r.ok) {
      failed++;
      console.log(`  ✗ ${name.padEnd(13)} HTTP ${r.status}  ${r.text.slice(0, 220)}`);
      continue;
    }
    let parsed = false;
    try {
      JSON.parse(r.text);
      parsed = true;
    } catch {}
    if (!parsed) failed++;
    console.log(
      `  ${parsed ? '✓' : '✗'} ${name.padEnd(13)} ${String(r.ms).padStart(5)}ms  ` +
        `${r.usage?.total ?? '?'} tok  ${parsed ? 'valid JSON' : 'UNPARSEABLE: ' + r.text.slice(0, 120)}`,
    );
  }
  console.log(
    failed === 0
      ? '\nPASS — every per-step schema is accepted and returns parseable JSON.\n'
      : `\nFAIL — ${failed} schema(s) rejected. Flatten further or drop responseSchema and rely on json-repair.\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
