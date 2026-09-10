import { describe, expect, it } from 'vitest';
import type { Question, Requirement } from '../../../schemas/index.js';
import type { Deps, LlmProvider, LlmRequest, LlmResult } from '../ports.js';
import { makeBudget, noopProgress, systemClock } from '../ports.js';
import { categoryApplies, generateQuestions, routeRequirements } from './generate.js';
import { noHiringProcess } from './research.js';

/**
 * These run against a fake model, so they test OUR logic — routing, scope discipline, the
 * coverage loop, the fallback — not the model's prose. Prompt quality is measured separately
 * by `npm run probe:extract` against the live API.
 */

const req = (id: string, text: string, kind: Requirement['kind'] = 'technical', priority: Requirement['priority'] = 'must'): Requirement => ({
  id,
  text,
  kind,
  priority,
});

/** A model that answers question requests with n questions tagged to the ids it was given. */
function fakeLlm(
  opts: {
    perCall?: number;
    onlyTagFirst?: boolean;
    emptyFor?: string[];
    /** Returns nothing the FIRST time these categories are asked, then answers — which is
     *  what forces the coverage loop to run a genuine second pass. */
    emptyFirstFor?: string[];
  } = {},
): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  const asked = new Map<string, number>();
  return {
    name: 'fake',
    calls,
    async complete(req: LlmRequest): Promise<LlmResult> {
      calls.push(req);
      const ids = [...req.user.matchAll(/^- (r\d+)/gm)].map((m) => m[1]!);
      const category = /ONE category only: ([a-z-]+)/.exec(req.system ?? '')?.[1] ?? 'technical';
      const seen = (asked.get(category) ?? 0) + 1;
      asked.set(category, seen);
      if (opts.emptyFor?.includes(category)) return reply(JSON.stringify({ questions: [] }));
      if (opts.emptyFirstFor?.includes(category) && seen === 1) return reply(JSON.stringify({ questions: [] }));
      const n = opts.perCall ?? Math.max(1, ids.length);
      const questions = Array.from({ length: n }, (_, i) => {
        const target = opts.onlyTagFirst ? ids[0] : ids[i % Math.max(1, ids.length)];
        const text = /- r\d+ \([^)]*\): (.*)$/m.exec(req.user)?.[1] ?? 'the requirement';
        return {
          requirement_ids: target ? [target] : [],
          // Echo requirement words so the link-quality gate accepts the link.
          prompt: `About ${text}: walk me through it (${category} ${i})`,
          answer_outline: `Cover ${text}.`,
          difficulty: (i % 3) + 1,
        };
      });
      return reply(JSON.stringify({ questions }));
    },
  };
}

const reply = (text: string): LlmResult => ({
  text,
  model: 'fake',
  provider: 'fake',
  usage: { prompt: 0, output: 0, total: 0 },
  cached: false,
  ms: 0,
});

function deps(llm: LlmProvider): Deps {
  return {
    llm,
    fetcher: {
      budget: makeBudget(16),
      async get() {
        throw new Error('no fetching in this test');
      },
    },
    search: { name: 'none', async search() { return []; } },
    clock: systemClock,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    progress: noopProgress,
    allowPrivateUrls: true,
  };
}

describe('routeRequirements — the model never decides what it is asked about', () => {
  const requirements = [
    req('r1', 'Node.js services'),
    req('r2', 'Mentoring junior engineers', 'behavioural'),
    req('r3', 'Design distributed systems for scale'),
    req('r4', 'Logistics domain knowledge', 'domain'),
  ];

  it('sends technical requirements to the technical call', () => {
    expect(routeRequirements('technical', requirements).map((r) => r.id)).toEqual(['r1', 'r3']);
  });

  it('sends behavioural requirements to the behavioural call', () => {
    expect(routeRequirements('behavioural', requirements).map((r) => r.id)).toEqual(['r2']);
  });

  it('routes only design-shaped requirements to system-design', () => {
    expect(routeRequirements('system-design', requirements).map((r) => r.id)).toEqual(['r3']);
  });

  /** Regression: system-design once fell back to ALL requirements and tagged a mentoring
   *  requirement to a design question. A design question may only cite technical work. */
  it('never lets a system-design question cite a behavioural requirement', async () => {
    const behaviouralOnly = [
      req('r1', 'Deep PostgreSQL experience with query tuning'),
      req('r2', 'Mentoring junior engineers through hard work', 'behavioural'),
    ];
    const result = await generateQuestions(
      { role: 'Engineer', seniority: 'senior', requirements: behaviouralOnly, hiring: noHiringProcess(), companyFacts: '' },
      deps(fakeLlm()),
    );
    const design = result.questions.filter((q) => q.category === 'system-design');
    for (const q of design) expect(q.requirement_ids).not.toContain('r2');
  });

  it('routes domain and behavioural requirements to company-fit', () => {
    expect(routeRequirements('company-fit', requirements).map((r) => r.id)).toEqual(['r2', 'r4']);
  });
});

describe('categoryApplies — a discovered hiring process changes the kit', () => {
  const design = [req('r1', 'Design distributed systems')];

  it('includes system design when the company publishes a design round', () => {
    const hiring = { ...noHiringProcess(), found: true, hasSystemDesign: true };
    expect(categoryApplies('system-design', 'junior', hiring, [])).toBe(true);
  });

  it('skips system design for a junior role at a company that says nothing', () => {
    expect(categoryApplies('system-design', 'junior', noHiringProcess(), design)).toBe(false);
  });

  it('includes system design for a senior role', () => {
    expect(categoryApplies('system-design', 'senior', noHiringProcess(), design)).toBe(true);
  });
});

describe('generateQuestions', () => {
  const requirements = [
    req('r1', 'Deep PostgreSQL experience with query tuning'),
    req('r2', 'Mentoring junior engineers through hard work', 'behavioural'),
    req('r3', 'Kubernetes in production', 'technical', 'nice'),
  ];

  it('makes ONE call per applicable category, not one call for everything', async () => {
    const llm = fakeLlm();
    await generateQuestions(
      { role: 'Senior Backend Engineer', seniority: 'senior', requirements, hiring: noHiringProcess(), companyFacts: '' },
      deps(llm),
    );
    const categories = llm.calls
      .map((c) => /ONE category only: ([a-z-]+)/.exec(c.system ?? '')?.[1])
      .filter(Boolean);
    expect(new Set(categories).size).toBeGreaterThan(1);
    expect(categories).toContain('technical');
    expect(categories).toContain('behavioural');
  });

  it('covers every must-have requirement', async () => {
    const result = await generateQuestions(
      { role: 'Engineer', seniority: 'senior', requirements, hiring: noHiringProcess(), companyFacts: '' },
      deps(fakeLlm()),
    );
    const covered = new Set(result.questions.flatMap((q) => q.requirement_ids));
    for (const r of requirements.filter((x) => x.priority === 'must')) {
      expect(covered.has(r.id), `${r.id} uncovered`).toBe(true);
    }
  });

  it('runs a second pass when the first leaves a must-have uncovered', async () => {
    // r2 is behavioural, and BOTH the behavioural and company-fit calls are routed
    // behavioural requirements — so both must come back empty the first time for r2 to be
    // genuinely uncovered after pass 1. Then the deterministic diff drives a real pass 2.
    const result = await generateQuestions(
      { role: 'Engineer', seniority: 'senior', requirements, hiring: noHiringProcess(), companyFacts: '' },
      deps(fakeLlm({ emptyFirstFor: ['behavioural', 'company-fit'] })),
    );
    expect(result.passes).toBeGreaterThan(1);
    const covered = new Set(result.questions.flatMap((q) => q.requirement_ids));
    expect(covered.has('r2')).toBe(true);
  });

  it('falls back to a synthesised question rather than shipping an uncovered must-have', async () => {
    const result = await generateQuestions(
      { role: 'Engineer', seniority: 'senior', requirements, hiring: noHiringProcess(), companyFacts: '' },
      deps(fakeLlm({ emptyFor: ['technical', 'behavioural', 'system-design', 'company-fit'] })),
    );
    const covered = new Set(result.questions.flatMap((q) => q.requirement_ids));
    expect(covered.has('r1')).toBe(true);
    expect(covered.has('r2')).toBe(true);
    expect(result.notes.some((n) => n.code === 'FALLBACK_QUESTION_USED')).toBe(true);
  });

  /**
   * REGRESSION: found by running a real regeneration through the API. Regenerating the
   * technical section produced a BEHAVIOURAL question via the coverage loop, which then sat
   * outside the merge scope and appeared in a section the user never asked to regenerate.
   */
  it('a scoped regeneration NEVER produces questions outside that scope', async () => {
    const result = await generateQuestions(
      {
        role: 'Engineer',
        seniority: 'senior',
        requirements,
        hiring: noHiringProcess(),
        companyFacts: '',
        categories: ['technical'],
        existingIds: ['q1', 'q2'],
        cacheSalt: 'job-123',
      },
      deps(fakeLlm({ onlyTagFirst: true, perCall: 1 })),
    );
    const categories = new Set(result.questions.map((q) => q.category));
    expect([...categories]).toEqual(['technical']);
  });

  it('never reuses an existing question id', async () => {
    const result = await generateQuestions(
      {
        role: 'Engineer',
        seniority: 'senior',
        requirements,
        hiring: noHiringProcess(),
        companyFacts: '',
        existingIds: ['q1', 'q2', 'q3'],
      },
      deps(fakeLlm()),
    );
    for (const q of result.questions) expect(['q1', 'q2', 'q3']).not.toContain(q.id);
  });

  it('drops model-invented requirement ids instead of storing them', async () => {
    const llm: LlmProvider = {
      name: 'fake',
      async complete() {
        return reply(
          JSON.stringify({
            questions: [
              { requirement_ids: ['r999'], prompt: 'Invented link', answer_outline: '', difficulty: 2 },
              { requirement_ids: ['r1'], prompt: 'Deep PostgreSQL experience with query tuning?', answer_outline: 'tuning', difficulty: 2 },
            ],
          }),
        );
      },
    };
    const result = await generateQuestions(
      { role: 'Engineer', seniority: 'senior', requirements: [requirements[0]!], hiring: noHiringProcess(), companyFacts: '' },
      deps(llm),
    );
    for (const q of result.questions) {
      for (const id of q.requirement_ids) expect(id).not.toBe('r999');
    }
  });

  it('survives unreadable model JSON without throwing', async () => {
    const llm: LlmProvider = {
      name: 'broken',
      async complete() {
        return reply('this is not JSON at all');
      },
    };
    const result = await generateQuestions(
      { role: 'Engineer', seniority: 'senior', requirements, hiring: noHiringProcess(), companyFacts: '' },
      deps(llm),
    );
    // No questions from the model, but the must-haves are still covered by the fallback.
    const covered = new Set(result.questions.flatMap((q: Question) => q.requirement_ids));
    expect(covered.has('r1')).toBe(true);
  });
});
