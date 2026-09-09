/**
 * MANDATORY BATCH ENTRY POINT — Section 9 of the brief, frozen shape.
 *
 *   npm run evaluate -- --input <cases.json> --output <kits.json>
 *
 * Guarantees the brief asks for, each implemented deliberately:
 *  - runs the SAME generateKit the web app uses; there is no parallel implementation
 *  - uses the per-case `days` value when building the schedule
 *  - continues after a failure, recording it rather than aborting the run
 *  - writes the Appendix B shape, one entry per input case
 *  - reserves status:'failed' for "no kit at all" — a missing hiring page is `ok`
 *  - reads credentials from env only (documented in .env.example)
 *  - runs from a clean clone: `npm install && npm run evaluate -- ...`
 *
 * `--offline` runs entirely from the committed .cache/ with no API key, so a reviewer can
 * see the pipeline work without credentials.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BatchCase, type BatchOutput, type BatchResult, validateKit } from '@prepkit/schema';
import { FileCache, GeminiProvider, HttpFetcher, NullSearch, defaultSearch } from '@prepkit/adapters';
import {
  PipelineError,
  RateLimitedQueue,
  consoleLogger,
  generateKit,
  noopProgress,
  systemClock,
  type Deps,
  type StepEvent,
} from '@prepkit/core';

const CASE_TIMEOUT_MS = Number(process.env.CASE_TIMEOUT_MS ?? 150_000);
const CONCURRENCY = Number(process.env.EVALUATE_CONCURRENCY ?? 2);

interface Args {
  input: string;
  output: string;
  offline: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { input: '', output: 'kits.json', offline: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') args.input = argv[++i] ?? '';
    else if (a === '--output' || a === '-o') args.output = argv[++i] ?? '';
    else if (a === '--offline') args.offline = true;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    }
  }
  if (!args.input) {
    usage();
    process.exit(2);
  }
  return args;
}

function usage(): void {
  console.log(`
Usage: npm run evaluate -- --input <cases.json> --output <kits.json> [--offline] [--verbose]

  --input   JSON array of cases: [{ id, jd, company_url, days }]
  --output  where to write the kits file (default kits.json)
  --offline run from the committed .cache/ with no API key and no network
  --verbose print each pipeline step as it runs

Environment (see .env.example): GEMINI_API_KEY, GEMINI_MODEL, ALLOW_PRIVATE_URLS
`);
}

function buildDeps(opts: { offline: boolean; verbose: boolean; caseId: string; queue: RateLimitedQueue }): Deps {
  const cache = new FileCache(resolve(process.cwd(), '.cache'));
  const apiKey = process.env.GEMINI_API_KEY ?? '';
  if (!apiKey && !opts.offline) {
    throw new PipelineError(
      'GEMINI_API_KEY is not set. Get a free key (no credit card) at https://aistudio.google.com/apikey, ' +
        'or run with --offline to use the committed cache.',
      'LLM_UNAVAILABLE',
    );
  }

  const llm = new GeminiProvider({
    apiKey,
    ...(process.env.GEMINI_MODEL ? { model: process.env.GEMINI_MODEL } : {}),
    cache,
    queue: opts.queue,
    offline: opts.offline,
    onRetry: ({ attempt, waitMs, error }) =>
      console.warn(`  [${opts.caseId}] provider retry ${attempt} in ${Math.round(waitMs)}ms: ${describe(error)}`),
  });

  /**
   * In offline mode EVERY fetch is a cache read — there is no network egress at all — so the
   * SSRF port/address rules have nothing to protect and rejecting localhost:8099 would only
   * break the fixtures. Offline therefore implies the flag.
   *
   * This mattered: without it, a clean clone with no .env rejected the Appendix B URL as
   * BAD_PORT, which cascaded into an empty brief, a different question prompt, and a cache
   * miss — so `--offline` only worked for someone who already had a .env.
   */
  const allowPrivate = process.env.ALLOW_PRIVATE_URLS === 'true' || opts.offline;
  const fetcher = new HttpFetcher({
    allowPrivate,
    maxPages: Number(process.env.FETCH_MAX_PAGES ?? 16),
    cache,
    offline: opts.offline,
  });

  return {
    llm,
    fetcher,
    search: opts.offline
      ? new NullSearch()
      : defaultSearch({
          cache,
          ...(process.env.BRAVE_API_KEY ? { braveApiKey: process.env.BRAVE_API_KEY } : {}),
          onFallback: (from, e) =>
            opts.verbose && console.warn(`  [${opts.caseId}] search provider ${from} unavailable: ${describe(e)}`),
        }),
    clock: systemClock,
    logger: opts.verbose ? consoleLogger : { info: () => {}, warn: () => {}, error: consoleLogger.error },
    progress: opts.verbose
      ? {
          step: (e: StepEvent) =>
            console.log(
              `  [${opts.caseId}] ${e.step.padEnd(10)} ${e.status.padEnd(8)} ${e.detail ?? ''}${
                e.elapsedMs ? ` (${(e.elapsedMs / 1000).toFixed(1)}s)` : ''
              }`,
            ),
        }
      : noopProgress,
    allowPrivateUrls: allowPrivate,
  };
}

async function runCase(raw: unknown, args: Args, queue: RateLimitedQueue): Promise<BatchResult> {
  const parsed = BatchCase.safeParse(raw);
  if (!parsed.success) {
    const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : 'unknown';
    return {
      id,
      status: 'failed',
      kit: null,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
    };
  }
  const c = parsed.data;
  const started = Date.now();

  try {
    const deps = buildDeps({ offline: args.offline, verbose: args.verbose, caseId: c.id, queue });
    const result = await withTimeout(
      generateKit({ jd: c.jd, companyUrl: c.company_url, days: c.days }, deps),
      CASE_TIMEOUT_MS,
      c.id,
    );

    // Validate before emitting: the brief requires kits to match the expected structure.
    const validated = validateKit(result.kit);
    if (!validated.ok) {
      return {
        id: c.id,
        status: 'failed',
        kit: null,
        error: {
          code: 'INTERNAL',
          message: `kit failed validation: ${[...validated.zodErrors, ...validated.issues.map((i) => i.message)].slice(0, 2).join('; ')}`,
        },
      };
    }

    const musts = result.kit.role.requirements.filter((r) => r.priority === 'must').length;
    const uncoveredMusts = result.kit.coverage.uncovered_requirement_ids.filter((id) =>
      result.kit.role.requirements.some((r) => r.id === id && r.priority === 'must'),
    ).length;
    console.log(
      `  ok      ${c.id.padEnd(10)} ${(Date.now() - started) / 1000 > 0 ? `${((Date.now() - started) / 1000).toFixed(1)}s`.padStart(7) : ''}  ` +
        `${result.kit.role.requirements.length} reqs (${musts} must), ${result.kit.questions.length} questions, ` +
        `${result.kit.schedule.days.length} days, ${result.kit.coverage.passes} passes, ${uncoveredMusts} uncovered musts`,
    );
    return { id: c.id, status: 'ok', kit: result.kit, error: null };
  } catch (e) {
    const code = e instanceof PipelineError ? e.code : isTimeout(e) ? 'CASE_TIMEOUT' : 'INTERNAL';
    console.log(`  FAILED  ${c.id.padEnd(10)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${code}: ${describe(e)}`);
    return { id: c.id, status: 'failed', kit: null, error: { code, message: describe(e) } };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolve(process.cwd(), args.input);
  const outputPath = resolve(process.cwd(), args.output);

  let cases: unknown[];
  try {
    const raw = await readFile(inputPath, 'utf8');
    const data: unknown = JSON.parse(raw);
    cases = Array.isArray(data) ? data : [];
    if (!Array.isArray(data)) throw new Error('the input file must contain a JSON array of cases');
  } catch (e) {
    console.error(`Could not read ${inputPath}: ${describe(e)}`);
    process.exit(1);
  }

  console.log(
    `\nevaluate: ${cases.length} case(s), concurrency ${CONCURRENCY}, ` +
      `${args.offline ? 'OFFLINE (cache only)' : `model ${process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite'}`}\n`,
  );

  const queue = new RateLimitedQueue({
    concurrency: CONCURRENCY,
    tokensPerMinute: Number(process.env.LLM_TPM ?? 0),
    requestsPerMinute: Number(process.env.LLM_RPM ?? 0),
  });

  const started = Date.now();
  const results: BatchResult[] = [];
  let next = 0;

  // One failure never aborts the run, and partial results are flushed as they land so an
  // interrupted run still leaves a usable file.
  const worker = async (): Promise<void> => {
    while (next < cases.length) {
      const i = next++;
      results.push(await runCase(cases[i], args, queue));
      await flush(outputPath, results);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));

  await flush(outputPath, results);

  const ok = results.filter((r) => r.status === 'ok').length;
  const elapsed = (Date.now() - started) / 1000;
  console.log(`\n${ok}/${results.length} ok in ${elapsed.toFixed(1)}s -> ${outputPath}`);
  if (elapsed > 900) console.warn('WARNING: exceeded the 15-minute budget the brief sets for five cases.');
  process.exit(0);
}

/**
 * Incremental flush so an interrupted run still leaves a usable file.
 *
 * Serialised, with a per-write temp name: two workers finishing at once previously wrote the
 * SAME `<output>.tmp`, and whichever renamed second failed with ENOENT — killing the run at
 * the very end, after every case had already succeeded.
 */
let flushChain: Promise<void> = Promise.resolve();

function flush(outputPath: string, kits: BatchResult[]): Promise<void> {
  const snapshot = [...kits];
  flushChain = flushChain.then(async () => {
    const payload: BatchOutput = {
      version: '1.0',
      generated_at: new Date().toISOString(),
      kits: snapshot,
    };
    await mkdir(dirname(outputPath), { recursive: true });
    const tmp = `${outputPath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
    await rename(tmp, outputPath);
  });
  return flushChain;
}

async function withTimeout<T>(p: Promise<T>, ms: number, id: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`case ${id} exceeded ${ms}ms`), { timeout: true })), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

const isTimeout = (e: unknown): boolean => (e as { timeout?: boolean })?.timeout === true;
const describe = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);

main().catch((e) => {
  console.error(`evaluate failed: ${describe(e)}`);
  process.exit(1);
});
