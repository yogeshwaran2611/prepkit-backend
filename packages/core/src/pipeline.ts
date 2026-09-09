import { type Kit, type KitNote, type Question, validateKit } from '@prepkit/schema';
import type { Deps, StepEvent } from './ports.js';
import { dedupeNotes, note } from './notes.js';
import { summarizeCoverage } from './coverage.js';
import { allocateSchedule } from './schedule.js';
import { PROMPT_VERSION } from './prompts/index.js';
import { extractRoleFromJd } from './steps/extract.js';
import { crawlCompanySite } from './steps/crawl.js';
import { buildCompanyBrief, findHiringProcess, noHiringProcess, searchPublicDiscussion } from './steps/research.js';
import { generateFlashcards, generateQuestions, hiringFactsText } from './steps/generate.js';

/**
 * PLAN.md §4.4 — the orchestrator. Runs S1..S8 in the order the brief requires and returns
 * a validated kit.
 *
 * Failure policy: every RESEARCH step degrades to an honest empty result plus a note. Only
 * S1 (nothing extractable at all) or a total LLM outage is fatal — "skip and report a source
 * that cannot be retrieved, rather than failing the whole run".
 */

export interface GenerateKitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export interface PipelineResult {
  kit: Kit;
  stepLog: StepEvent[];
  promptVersion: string;
}

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly code: 'COMPANY_UNREACHABLE' | 'LLM_UNAVAILABLE' | 'INVALID_INPUT' | 'EXTRACTION_EMPTY' | 'CASE_TIMEOUT' | 'INTERNAL',
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export async function generateKit(input: GenerateKitInput, deps: Deps): Promise<PipelineResult> {
  const stepLog: StepEvent[] = [];
  const capture: Deps = {
    ...deps,
    progress: {
      step: (e) => {
        stepLog.push(e);
        deps.progress.step(e);
      },
    },
  };

  const days = Math.max(1, Math.min(60, Math.trunc(input.days)));
  if (!Number.isFinite(input.days) || input.days < 1) {
    throw new PipelineError('Days must be a whole number between 1 and 60.', 'INVALID_INPUT');
  }
  if (!input.jd?.trim()) {
    throw new PipelineError('A job description is required.', 'INVALID_INPUT');
  }

  const notes: KitNote[] = [];

  // --- S1: pasted text needs no retrieval, so it runs first and shapes every later query.
  const role = await extractRoleFromJd(input.jd, capture).catch((e: unknown) => {
    const code = (e as { code?: string })?.code === 'EXTRACTION_EMPTY' ? 'EXTRACTION_EMPTY' : 'LLM_UNAVAILABLE';
    throw new PipelineError(
      code === 'EXTRACTION_EMPTY'
        ? 'Nothing could be extracted from that job description.'
        : `The language model was unavailable: ${(e as Error)?.message ?? 'unknown error'}`,
      code,
    );
  });
  notes.push(...role.notes);

  // --- S2: a homepage is useless until crawled. Never throws.
  const crawl = await crawlCompanySite(input.companyUrl, role.companyFromJd, capture);
  notes.push(...crawl.notes);

  // --- S3: only meaningful once S2 has produced candidates.
  const hiring = crawl.pages.length ? await softFail(() => findHiringProcess(crawl, capture), noHiringProcess()) : noHiringProcess();
  notes.push(...hiring.notes);

  // --- S4: runs even when S2/S3 found nothing — the company NAME is enough.
  const signal = await softFail(
    () => searchPublicDiscussion(crawl.companyName, role.title, capture),
    { hits: [], pages: [], notes: [note('NO_PUBLIC_DISCUSSION')] },
  );
  notes.push(...signal.notes);

  // --- S5: grounded only in what was actually fetched.
  const brief = await softFail(
    () => buildCompanyBrief(crawl.companyName, crawl, hiring, signal, capture),
    {
      summary: 'We could not build a company brief from the available sources.',
      what_they_do: '',
      sources: [],
      confidence: 'none' as const,
      notes: [],
    },
  );
  notes.push(...brief.notes);

  // --- S6 + S7: one call per category, then the deterministic coverage loop.
  const generated = await generateQuestions(
    {
      role: role.title || 'this role',
      seniority: role.seniority,
      requirements: role.requirements,
      hiring,
      companyFacts: [brief.what_they_do, brief.summary].filter(Boolean).join(' '),
    },
    capture,
  ).catch((e: unknown) => {
    throw new PipelineError(`Question generation failed: ${(e as Error)?.message ?? 'unknown error'}`, 'LLM_UNAVAILABLE');
  });
  notes.push(...generated.notes);

  const flashcards = await softFail(
    () => generateFlashcards({ role: role.title || 'this role', requirements: role.requirements }, capture),
    [],
  );

  // --- S8: arithmetic. No LLM.
  capture.progress.step({ step: 'schedule', status: 'start', at: deps.clock.now().toISOString() });
  const schedule = allocateSchedule(generated.questions, role.requirements, days);
  if (schedule.overloaded) notes.push(note('SCHEDULE_OVERLOADED', schedule.overloaded));
  capture.progress.step({
    step: 'schedule',
    status: 'ok',
    detail: `${schedule.days.length} days, ${schedule.days.filter((d) => d.kind === 'review').length} review`,
    at: deps.clock.now().toISOString(),
  });

  const kit: Kit = {
    source: {
      company: crawl.companyName,
      company_url: input.companyUrl,
      role: role.title,
      location: role.location,
      jd_chars: input.jd.trim().length,
      researched_at: deps.clock.now().toISOString(),
      pages_used: [...crawl.pages, ...signal.pages].map((p) => p.finalUrl),
    },
    company_brief: {
      summary: brief.summary,
      what_they_do: brief.what_they_do,
      sources: brief.sources,
      ...(brief.hiring_process ? { hiring_process: brief.hiring_process } : {}),
      confidence: brief.confidence,
    },
    role: {
      title: role.title,
      seniority: role.seniority,
      responsibilities: role.responsibilities,
      requirements: role.requirements,
    },
    questions: generated.questions,
    flashcards,
    schedule: { days_available: days, days: schedule.days },
    coverage: summarizeCoverage(role.requirements, generated.questions, generated.passes),
    notes: dedupeNotes(notes),
    order: {
      questions: generated.questions.map((q) => q.id),
      flashcards: flashcards.map((f) => f.id),
    },
  };

  const validated = validateKit(kit);
  if (!validated.ok) {
    // A structurally invalid kit is a bug in OUR assembly, not in the model's reply, so it
    // is reported loudly rather than silently patched.
    deps.logger.error('assembled kit failed validation', {
      zodErrors: validated.zodErrors,
      issues: validated.issues.map((i) => `${i.code}: ${i.message}`),
    });
    throw new PipelineError(
      `The generated kit did not match the expected structure: ${[
        ...validated.zodErrors,
        ...validated.issues.map((i) => i.message),
      ]
        .slice(0, 3)
        .join('; ')}`,
      'INTERNAL',
    );
  }

  return { kit: validated.kit, stepLog, promptVersion: PROMPT_VERSION };
}

/** A research step that throws degrades to its empty shape; the run continues. */
async function softFail<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Regenerating one section: same steps, narrower scope. Used by the API (§5). */
export async function regenerateQuestionsSection(
  input: {
    kit: Kit;
    category: Question['category'];
    /** Salt so the cache cannot hand back the identical section (§4.5). */
    cacheSalt: string;
  },
  deps: Deps,
): Promise<{ questions: Question[]; notes: KitNote[] }> {
  const hiring = input.kit.company_brief.hiring_process
    ? {
        found: true,
        stages: [],
        hasTakeHome: /take[-\s]?home/i.test(input.kit.company_brief.hiring_process),
        hasSystemDesign: /system\s*design/i.test(input.kit.company_brief.hiring_process),
        timeline: '',
        summary: input.kit.company_brief.hiring_process,
        sources: [],
        notes: [],
      }
    : noHiringProcess();

  const result = await generateQuestions(
    {
      role: input.kit.role.title || 'this role',
      seniority: input.kit.role.seniority,
      requirements: input.kit.role.requirements,
      hiring,
      companyFacts: [input.kit.company_brief.what_they_do, input.kit.company_brief.summary].filter(Boolean).join(' '),
      existingIds: input.kit.questions.map((q) => q.id),
      cacheSalt: input.cacheSalt,
      categories: [input.category],
    },
    deps,
  );
  void hiringFactsText;
  return { questions: result.questions, notes: result.notes };
}
