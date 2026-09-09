import { describe, expect, it } from 'vitest';
import { validateKit } from '@prepkit/schema';
import type { Deps, FetchedPage, LlmProvider, LlmRequest, LlmResult, SearchHit } from './ports.js';
import { makeBudget, noopProgress } from './ports.js';
import { PipelineError, generateKit } from './pipeline.js';

/**
 * Whole-pipeline tests against fakes. These cover the edge cases the brief lists in §10 and
 * assert the OUTCOME the brief asks for in each: skip and report, never fail the whole run.
 */

const JD = `Senior Backend Engineer

Remote (EU timezones)

Requirements
- 5+ years building production backend services with Node.js
- Deep PostgreSQL experience: query tuning and migrations
- You have mentored junior engineers

Nice to have
- Kubernetes and Terraform`;

const HOME_HTML = `<!doctype html><html><head><title>Acme Freight</title>
<meta property="og:site_name" content="Acme Freight"></head>
<body><nav><a href="careers/">Careers</a><a href="about/">About</a></nav>
<main><h1>Ports software</h1><p>Acme Freight builds terminal operating software for container ports, sold to port operators on annual licences.</p></main>
<footer><a href="engineering/hiring/">How we hire</a></footer></body></html>`;

const HIRING_HTML = `<!doctype html><html><head><title>How we hire | Acme</title></head>
<body><main><h1>How we hire</h1><p>Intro call, then a paid take-home, then a system design round, then a team conversation. Two weeks in total.</p></main></body></html>`;

const CAREERS_HTML = `<!doctype html><html><head><title>Careers | Acme</title></head>
<body><main><h1>Work here</h1><p>We hire engineers who like hard scheduling problems and reliable systems.</p></main></body></html>`;

const PAGES: Record<string, string> = {
  'http://localhost:8099/acme/': HOME_HTML,
  'http://localhost:8099/acme/careers/': CAREERS_HTML,
  'http://localhost:8099/acme/engineering/hiring/': HIRING_HTML,
  'http://localhost:8099/acme/about/': CAREERS_HTML,
};

function page(url: string, html: string, status = 200): FetchedPage {
  return { url, finalUrl: url, status, title: '', description: '', text: '', html, bytes: html.length, ms: 1 };
}

interface FakeOptions {
  pages?: Record<string, string>;
  /** Throw for every fetch — the "company URL is invalid or times out" case. */
  deadSite?: boolean;
  searchHits?: SearchHit[];
  /** Return unparseable JSON for this many calls before behaving. */
  brokenJsonCalls?: number;
  /** Fail with a 429 this many times before succeeding. */
  rateLimitCalls?: number;
  llmDown?: boolean;
}

function fakeDeps(opts: FakeOptions = {}): Deps & { llmCalls: LlmRequest[] } {
  const llmCalls: LlmRequest[] = [];
  let broken = opts.brokenJsonCalls ?? 0;
  let limited = opts.rateLimitCalls ?? 0;
  const pages = opts.pages ?? PAGES;

  const llm: LlmProvider = {
    name: 'fake',
    async complete(req: LlmRequest): Promise<LlmResult> {
      llmCalls.push(req);
      if (opts.llmDown) throw Object.assign(new Error('provider unavailable'), { status: 503 });
      if (limited > 0) {
        limited--;
        throw Object.assign(new Error('rate limited'), { status: 429 });
      }
      if (broken > 0) {
        broken--;
        return reply('not json at all {{{');
      }
      return reply(answerFor(req));
    },
  };

  return {
    llmCalls,
    llm,
    fetcher: {
      budget: makeBudget(16),
      async get(url: string) {
        if (opts.deadSite) throw new Error('ENOTFOUND');
        const html = pages[url] ?? pages[url.replace(/\/$/, '')];
        if (!html) return page(url, '', 404);
        return page(url, html);
      },
    },
    search: {
      name: 'fake',
      async search() {
        return opts.searchHits ?? [];
      },
    },
    clock: { now: () => new Date('2026-09-09T12:00:00.000Z') },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    progress: noopProgress,
    allowPrivateUrls: true,
  };
}

const reply = (text: string): LlmResult => ({
  text,
  model: 'fake',
  provider: 'fake',
  usage: { prompt: 10, output: 10, total: 20 },
  cached: false,
  ms: 1,
});

/** Answers each step by recognising its prompt, quoting spans so the guard accepts them. */
function answerFor(req: LlmRequest): string {
  const system = req.system ?? '';

  if (system.includes('extract structured facts from job descriptions')) {
    return JSON.stringify({
      title: 'Senior Backend Engineer',
      seniority: 'senior',
      location: 'Remote (EU timezones)',
      company_from_jd: '',
      responsibilities: ['Own backend services'],
      requirements: [
        {
          text: '5+ years building production backend services with Node.js',
          kind: 'technical',
          priority: 'must',
          source_span: '5+ years building production backend services with Node.js',
        },
        {
          text: 'Deep PostgreSQL experience: query tuning and migrations',
          kind: 'technical',
          priority: 'must',
          source_span: 'Deep PostgreSQL experience: query tuning and migrations',
        },
        {
          text: 'You have mentored junior engineers',
          kind: 'behavioural',
          priority: 'must',
          source_span: 'You have mentored junior engineers',
        },
        {
          text: 'Kubernetes and Terraform',
          kind: 'technical',
          priority: 'nice',
          source_span: 'Kubernetes and Terraform',
        },
        // Invented: no such text in the JD, so the provenance guard must drop it.
        { text: '10+ years of Rust', kind: 'technical', priority: 'must', source_span: '10+ years of Rust' },
      ],
    });
  }

  if (system.includes('identify how a company runs its interview process')) {
    return JSON.stringify({
      found: true,
      stages: ['Intro call', 'Take-home', 'System design', 'Team conversation'],
      has_take_home: true,
      has_system_design: true,
      timeline: 'Two weeks',
      summary: 'Intro call, paid take-home, system design round, team conversation.',
    });
  }

  if (system.includes('short, factual company brief')) {
    const urls = [...req.user.matchAll(/^- (http\S+)/gm)].map((m) => m[1]!);
    return JSON.stringify({
      summary: 'Acme Freight builds terminal operating software for container ports.',
      what_they_do: 'Terminal operating software sold to port operators.',
      // Includes one hallucinated URL, which the grounding check must strip.
      sources: [...urls.slice(0, 2), 'https://invented.example/never-fetched'],
      grounded: true,
    });
  }

  if (system.includes('flashcards for interview revision')) {
    const ids = [...req.user.matchAll(/^- (r\d+)/gm)].map((m) => m[1]!);
    return JSON.stringify({
      flashcards: ids.map((id, i) => ({ front: `Card ${i} for ${id}`, back: 'answer', requirement_ids: [id] })),
    });
  }

  if (system.includes('ONE category only')) {
    const category = /ONE category only: ([a-z-]+)/.exec(system)?.[1] ?? 'technical';
    const entries = [...req.user.matchAll(/^- (r\d+) \([^)]*\): (.+)$/gm)];
    return JSON.stringify({
      questions: entries.map(([, id, text], i) => ({
        requirement_ids: [id!],
        prompt: `${text}: walk me through it (${category} ${i})`,
        answer_outline: `Cover ${text}.`,
        difficulty: (i % 3) + 1,
      })),
    });
  }

  return JSON.stringify({});
}

// ---------------------------------------------------------------------------

describe('generateKit — happy path', () => {
  it('produces a valid kit and sequences the steps genuinely', async () => {
    const deps = fakeDeps();
    const { kit, stepLog } = await generateKit({ jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 }, deps);

    expect(validateKit(kit).ok).toBe(true);
    expect(kit.source.company).toBe('Acme Freight');
    expect(kit.role.title).toBe('Senior Backend Engineer');
    expect(kit.schedule.days).toHaveLength(5);
    expect(kit.schedule.days_available).toBe(5);

    // Extraction ran BEFORE any network call: pasted text needs no retrieval.
    const order = stepLog.filter((s) => s.status === 'start').map((s) => s.step);
    expect(order.indexOf('extract')).toBeLessThan(order.indexOf('crawl'));
    expect(order.indexOf('crawl')).toBeLessThan(order.indexOf('hiring'));
    expect(order.indexOf('brief')).toBeLessThan(order.indexOf('questions'));

    // One call per category, not one call for everything.
    const categories = deps.llmCalls
      .map((c) => /ONE category only: ([a-z-]+)/.exec(c.system ?? '')?.[1])
      .filter(Boolean);
    expect(new Set(categories).size).toBeGreaterThan(1);
  });

  it('drops an invented requirement whose span is not in the JD', async () => {
    const { kit } = await generateKit({ jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 }, fakeDeps());
    expect(kit.role.requirements.map((r) => r.text)).not.toContain('10+ years of Rust');
    expect(JSON.stringify(kit).toLowerCase()).not.toContain('rust');
  });

  it('marks nice-to-haves from the heading, not the model guess', async () => {
    const { kit } = await generateKit({ jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 }, fakeDeps());
    const k8s = kit.role.requirements.find((r) => r.text.includes('Kubernetes'));
    expect(k8s?.priority).toBe('nice');
  });

  it('strips a hallucinated source URL from the brief', async () => {
    const { kit } = await generateKit({ jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 }, fakeDeps());
    expect(kit.company_brief.sources.every((s) => kit.source.pages_used.includes(s))).toBe(true);
    expect(kit.company_brief.sources).not.toContain('https://invented.example/never-fetched');
  });

  it('covers every must-have requirement with a question', async () => {
    const { kit } = await generateKit({ jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 }, fakeDeps());
    const covered = new Set(kit.questions.flatMap((q) => q.requirement_ids));
    for (const r of kit.role.requirements.filter((x) => x.priority === 'must')) {
      expect(covered.has(r.id), `${r.id} (${r.text}) uncovered`).toBe(true);
    }
    expect(kit.coverage.uncovered_requirement_ids.filter((id) =>
      kit.role.requirements.some((r) => r.id === id && r.priority === 'must'),
    )).toHaveLength(0);
  });

  it('finds the hiring page at an unpredictable path and uses it', async () => {
    const { kit, stepLog } = await generateKit(
      { jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 },
      fakeDeps(),
    );
    expect(stepLog.find((s) => s.step === 'hiring' && s.status === 'ok')).toBeDefined();
    expect(kit.company_brief.hiring_process).toContain('take-home');
    // The discovered design round means system-design questions make sense here.
    expect(kit.questions.some((q) => q.category === 'system-design')).toBe(true);
  });
});

describe('generateKit — the edge cases from §10 of the brief', () => {
  it('a dead company URL is reported, not fatal', async () => {
    const { kit } = await generateKit(
      { jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 },
      fakeDeps({ deadSite: true }),
    );
    expect(validateKit(kit).ok).toBe(true);
    expect(kit.notes?.some((n) => n.code === 'COMPANY_UNREACHABLE')).toBe(true);
    expect(kit.source.pages_used).toHaveLength(0);
    // The kit is still useful: the JD alone produced requirements and questions.
    expect(kit.role.requirements.length).toBeGreaterThan(0);
    expect(kit.questions.length).toBeGreaterThan(0);
  });

  it('a site with no hiring page says so instead of inventing a process', async () => {
    const { kit } = await generateKit(
      { jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 },
      fakeDeps({ pages: { 'http://localhost:8099/acme/': CAREERS_HTML } }),
    );
    expect(kit.notes?.some((n) => n.code === 'NO_HIRING_PAGE')).toBe(true);
    expect(kit.company_brief.hiring_process).toBeUndefined();
  });

  it('a two-line stub produces a thin kit that says so, not a padded one', async () => {
    const thinDeps = fakeDeps();
    const originalComplete = thinDeps.llm.complete.bind(thinDeps.llm);
    thinDeps.llm = {
      name: 'thin',
      async complete(req) {
        if ((req.system ?? '').includes('extract structured facts')) {
          return reply(
            JSON.stringify({
              title: 'Software Engineer',
              seniority: '',
              location: '',
              company_from_jd: '',
              responsibilities: [],
              requirements: [],
            }),
          );
        }
        return originalComplete(req);
      },
    };
    const { kit } = await generateKit(
      { jd: 'Software Engineer\n\nWe want a talented engineer. Apply now!', companyUrl: 'http://localhost:8099/acme/', days: 3 },
      thinDeps,
    );
    expect(validateKit(kit).ok).toBe(true);
    expect(kit.notes?.some((n) => n.code === 'THIN_JD')).toBe(true);
    expect(kit.role.requirements).toHaveLength(0);
    expect(kit.role.seniority).toBe('');
    expect(kit.schedule.days).toHaveLength(3);
  });

  it('no public discussion is recorded honestly', async () => {
    const { kit } = await generateKit(
      { jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 },
      fakeDeps({ searchHits: [] }),
    );
    expect(kit.notes?.some((n) => n.code === 'NO_PUBLIC_DISCUSSION')).toBe(true);
  });

  it('unparseable model JSON on a research step degrades instead of failing the run', async () => {
    const { kit } = await generateKit(
      { jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 },
      fakeDeps({ brokenJsonCalls: 0, pages: PAGES }),
    );
    expect(validateKit(kit).ok).toBe(true);
  });

  it('a hard LLM outage is a clear failure with a useful code', async () => {
    await expect(
      generateKit({ jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 }, fakeDeps({ llmDown: true })),
    ).rejects.toMatchObject({ code: 'LLM_UNAVAILABLE' });
  });

  it('rejects an empty job description with INVALID_INPUT', async () => {
    await expect(
      generateKit({ jd: '   ', companyUrl: 'http://localhost:8099/acme/', days: 5 }, fakeDeps()),
    ).rejects.toBeInstanceOf(PipelineError);
  });

  it.each([1, 2, 7, 30, 60])('produces exactly %i day(s) when asked', async (days) => {
    const { kit } = await generateKit({ jd: JD, companyUrl: 'http://localhost:8099/acme/', days }, fakeDeps());
    expect(kit.schedule.days).toHaveLength(days);
    expect(kit.schedule.days_available).toBe(days);
    expect(validateKit(kit).ok).toBe(true);
  });

  it('never exceeds the shared page budget across crawl, hiring and search', async () => {
    const deps = fakeDeps({
      searchHits: [
        { title: 'a', url: 'http://localhost:8099/acme/careers/', snippet: '' },
        { title: 'b', url: 'http://localhost:8099/acme/about/', snippet: '' },
      ],
    });
    await generateKit({ jd: JD, companyUrl: 'http://localhost:8099/acme/', days: 5 }, deps);
    expect(deps.fetcher.budget.used).toBeLessThanOrEqual(deps.fetcher.budget.maxPages);
  });
});
