import { z } from 'zod';
import type { Flashcard, KitNote, Question, QuestionCategory, Requirement } from '@prepkit/schema';
import type { Deps } from '../ports.js';
import { note } from '../notes.js';
import { idAllocator } from '../ids.js';
import { flashcardsPrompt, flashcardsSchema, gapPrompt, questionsPrompt, questionsSchema } from '../prompts/index.js';
import { parseJson } from '../resilience/json.js';
import { truncateAtSentence } from '../security/sanitize.js';
import { fallbackQuestion, findCoverageGaps, pruneLinks } from '../coverage.js';
import type { HiringProcess } from './research.js';

/**
 * S6 + S7 — question generation and the coverage loop. PLAN.md §4.2, §4.3.
 *
 * The sequencing here is the point: one call PER CATEGORY, each seeing only the requirements
 * routed to it plus the hiring facts discovered in S3. "The two should not come from the
 * same call with the same instructions."
 */

export const MAX_PASSES = 3;
export const ALL_CATEGORIES: QuestionCategory[] = ['technical', 'behavioural', 'system-design', 'company-fit'];

const RawQuestions = z.object({
  questions: z
    .array(
      z.object({
        requirement_ids: z.array(z.string()).optional(),
        prompt: z.string().min(1),
        answer_outline: z.string().optional(),
        difficulty: z.number().optional(),
      }),
    )
    .optional(),
});

const RawFlashcards = z.object({
  flashcards: z
    .array(
      z.object({
        front: z.string().min(1),
        back: z.string().optional(),
        requirement_ids: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

/**
 * Which requirements does each category plausibly serve? Routed in CODE — the model is never
 * asked to decide what it should be asked about.
 */
export function routeRequirements(
  category: QuestionCategory,
  requirements: Requirement[],
): Requirement[] {
  switch (category) {
    case 'technical':
      return requirements.filter((r) => r.kind === 'technical');
    case 'behavioural':
      return requirements.filter((r) => r.kind === 'behavioural');
    case 'domain' as never:
      return [];
    case 'system-design':
      return requirements.filter(
        (r) => r.kind === 'technical' && /architect|design|scal|distribut|system|infra|micro|queue|event|latency|throughput|reliab|availab/i.test(r.text),
      );
    case 'company-fit':
      return requirements.filter((r) => r.kind === 'domain' || r.kind === 'behavioural');
    default:
      return requirements;
  }
}

/**
 * Should this category run at all? A junior role at a company with no published design round
 * should not get system-design questions — that is the discovered hiring process actually
 * changing the kit, which is what §4.2 requires.
 */
export function categoryApplies(
  category: QuestionCategory,
  seniority: string,
  hiring: HiringProcess,
  routed: Requirement[],
): boolean {
  if (category === 'system-design') {
    if (hiring.hasSystemDesign) return true;
    const junior = /junior|graduate|intern|entry|associate/i.test(seniority);
    if (junior) return false;
    return routed.length > 0 || /senior|staff|principal|lead|architect/i.test(seniority);
  }
  if (category === 'company-fit') return true;
  return routed.length > 0;
}

/**
 * When a category has no routed requirements but still applies, what may it see?
 *
 * NOT "everything" — that defeats the routing entirely. Found by test: system-design fell
 * back to the full list and tagged a *mentoring* requirement to a system-design question,
 * which is exactly the "one call with the same instructions" failure the brief warns about.
 */
function fallbackRequirements(category: QuestionCategory, all: Requirement[]): Requirement[] {
  switch (category) {
    case 'system-design':
      // Design questions may only reference technical requirements.
      return all.filter((r) => r.kind === 'technical');
    case 'company-fit':
      // Fit questions are about motivation and domain, so the whole list is legitimate.
      return all;
    default:
      return [];
  }
}

function questionCount(routed: Requirement[], category: QuestionCategory): number {
  const musts = routed.filter((r) => r.priority === 'must').length;
  if (category === 'company-fit') return 3;
  if (category === 'system-design') return Math.min(3, Math.max(2, musts));
  return Math.min(8, Math.max(3, musts + 1));
}

export interface GenerateOneInput {
  category: QuestionCategory;
  role: string;
  seniority: string;
  requirements: Requirement[];
  hiring: HiringProcess;
  companyFacts: string;
  existingPrompts: string[];
  allocId: () => string;
  cacheSalt?: string;
}

/** One category, one call. */
export async function generateQuestionsForCategory(
  input: GenerateOneInput,
  deps: Deps,
): Promise<Question[]> {
  const routed = input.requirements;
  if (!routed.length && input.category !== 'company-fit') return [];

  const res = await deps.llm.complete({
    system: questionsPrompt.system(input.category),
    user: questionsPrompt.build({
      category: input.category,
      role: input.role,
      seniority: input.seniority,
      requirements: routed,
      hiringFacts: hiringFactsText(input.hiring),
      companyFacts: input.companyFacts,
      existingPrompts: input.existingPrompts,
      count: questionCount(routed, input.category),
    }),
    responseSchema: questionsSchema,
    temperature: 0.4,
    ...(input.cacheSalt ? { cacheSalt: input.cacheSalt } : {}),
  });

  const parsed = parseJson(res.text, RawQuestions);
  if (!parsed.ok) {
    deps.logger.warn('question generation returned unreadable JSON', { category: input.category, error: parsed.error });
    return [];
  }

  const validIds = new Set(routed.map((r) => r.id));
  const out: Question[] = [];
  for (const raw of parsed.value.questions ?? []) {
    // Invalid ids are dropped in code; a question with none left is discarded.
    const ids = [...new Set((raw.requirement_ids ?? []).filter((id) => validIds.has(id)))].slice(0, 3);
    if (!ids.length) continue;
    const prompt = truncateAtSentence(raw.prompt.trim(), 600);
    const outline = truncateAtSentence((raw.answer_outline ?? '').trim(), 2_000);
    out.push({
      id: input.allocId(),
      requirement_ids: ids,
      category: input.category,
      prompt: prompt.text,
      answer_outline: outline.text,
      difficulty: clampDifficulty(raw.difficulty ?? 2),
      meta: { origin: 'generated', pinned: false, updated_at: deps.clock.now().toISOString() },
    });
  }
  return out;
}

const clampDifficulty = (d: number): 1 | 2 | 3 => {
  const n = Math.round(Number.isFinite(d) ? d : 2);
  return (n < 1 ? 1 : n > 3 ? 3 : n) as 1 | 2 | 3;
};

export function hiringFactsText(h: HiringProcess): string {
  if (!h.found) return '';
  const bits = [
    h.stages.length ? `Stages: ${h.stages.join(' -> ')}` : '',
    h.hasTakeHome ? 'They set a take-home exercise.' : '',
    h.hasSystemDesign ? 'They run a system design round.' : '',
    h.timeline ? `Timeline: ${h.timeline}` : '',
    h.summary,
  ].filter(Boolean);
  return bits.join('\n');
}

export interface GenerationResult {
  questions: Question[];
  passes: number;
  notes: KitNote[];
}

/**
 * S6 across all categories, then S7's deterministic loop: diff, generate for the gaps,
 * re-diff. Stops when no must-gap remains or MAX_PASSES is reached.
 */
export async function generateQuestions(
  input: {
    role: string;
    seniority: string;
    requirements: Requirement[];
    hiring: HiringProcess;
    companyFacts: string;
    existingIds?: string[];
    cacheSalt?: string;
    categories?: QuestionCategory[];
  },
  deps: Deps,
): Promise<GenerationResult> {
  const started = Date.now();
  deps.progress.step({ step: 'questions', status: 'start', at: deps.clock.now().toISOString() });

  const allocId = idAllocator('q', input.existingIds ?? []);
  const categories = input.categories ?? ALL_CATEGORIES;
  const notes: KitNote[] = [];
  let questions: Question[] = [];

  // --- pass 1: one call per category, sequentially (free-tier rate limits) ---
  for (const category of categories) {
    const routed = routeRequirements(category, input.requirements);
    if (!categoryApplies(category, input.seniority, input.hiring, routed)) {
      deps.logger.info('category skipped', { category, reason: 'not applicable to this role/process' });
      continue;
    }
    const visible = routed.length ? routed : fallbackRequirements(category, input.requirements);
    if (!visible.length) {
      deps.logger.info('category skipped', { category, reason: 'no requirements it may reference' });
      continue;
    }
    const produced = await generateQuestionsForCategory(
      {
        category,
        role: input.role,
        seniority: input.seniority,
        requirements: visible,
        hiring: input.hiring,
        companyFacts: input.companyFacts,
        existingPrompts: questions.map((q) => q.prompt),
        allocId,
        ...(input.cacheSalt ? { cacheSalt: input.cacheSalt } : {}),
      },
      deps,
    );
    questions.push(...produced);
  }

  // --- link-quality gate BEFORE the diff, so a bad link cannot close a gap ---
  const pruned = pruneLinks(questions, input.requirements);
  questions = pruned.questions;
  if (pruned.rejected > 0) {
    notes.push(note('LINKS_REJECTED', { rejected: pruned.rejected, questions_discarded: pruned.discarded.length }));
  }

  // --- S7: the coverage loop -------------------------------------------------
  let passes = 1;
  while (passes < MAX_PASSES) {
    const gaps = findCoverageGaps(input.requirements, questions).filter((g) => g.priority === 'must');
    if (!gaps.length) break;
    passes++;

    deps.progress.step({
      step: 'coverage',
      status: 'start',
      detail: `pass ${passes}: ${gaps.length} uncovered must-have(s)`,
      at: deps.clock.now().toISOString(),
    });

    const byId = new Map(input.requirements.map((r) => [r.id, r]));
    const gapReqs = gaps.map((g) => byId.get(g.requirement_id)).filter((r): r is Requirement => !!r);
    // The gap pass must stay INSIDE the requested scope. When regenerating one section,
    // `categories` is restricted, and a gap question in another category would land outside
    // the merge scope and silently appear in a section the user did not regenerate.
    const allowed = new Set(categories);
    const preferred: QuestionCategory = gapReqs.some((r) => r.kind === 'behavioural') ? 'behavioural' : 'technical';
    const category: QuestionCategory = allowed.has(preferred) ? preferred : categories[0]!;

    const res = await deps.llm.complete({
      system: questionsPrompt.system(category),
      user: gapPrompt.build({
        category,
        role: input.role,
        requirements: gapReqs,
        existingPrompts: questions.map((q) => q.prompt),
      }),
      responseSchema: questionsSchema,
      temperature: 0.35,
      ...(input.cacheSalt ? { cacheSalt: `${input.cacheSalt}:gap${passes}` } : {}),
    });

    const parsed = parseJson(res.text, RawQuestions);
    if (!parsed.ok) break;

    const validIds = new Set(gapReqs.map((r) => r.id));
    const added: Question[] = [];
    for (const raw of parsed.value.questions ?? []) {
      const ids = [...new Set((raw.requirement_ids ?? []).filter((id) => validIds.has(id)))].slice(0, 3);
      if (!ids.length) continue;
      const req = byId.get(ids[0]!);
      const wanted: QuestionCategory = req?.kind === 'behavioural' ? 'behavioural' : category;
      added.push({
        id: allocId(),
        requirement_ids: ids,
        // Clamped to the allowed set for the same reason as above.
        category: allowed.has(wanted) ? wanted : category,
        prompt: truncateAtSentence(raw.prompt.trim(), 600).text,
        answer_outline: truncateAtSentence((raw.answer_outline ?? '').trim(), 2_000).text,
        difficulty: clampDifficulty(raw.difficulty ?? 2),
        meta: { origin: 'generated', pinned: false, updated_at: deps.clock.now().toISOString() },
      });
    }
    const prunedGap = pruneLinks(added, input.requirements);
    questions.push(...prunedGap.questions);
  }

  // --- last resort: a kit must never ship with an uncovered must-have -------
  const remaining = findCoverageGaps(input.requirements, questions).filter((g) => g.priority === 'must');
  if (remaining.length) {
    const byId = new Map(input.requirements.map((r) => [r.id, r]));
    const allowedFinal = new Set(categories);
    for (const gap of remaining) {
      const req = byId.get(gap.requirement_id);
      if (!req) continue;
      const fq = fallbackQuestion(req, allocId());
      // A scoped regeneration must not invent a question in another section either.
      questions.push(allowedFinal.has(fq.category) ? fq : { ...fq, category: categories[0]! });
    }
    notes.push(note('FALLBACK_QUESTION_USED', { count: remaining.length, requirement_ids: remaining.map((g) => g.requirement_id) }));
  }

  deps.progress.step({
    step: 'questions',
    status: 'ok',
    detail: `${questions.length} questions across ${new Set(questions.map((q) => q.category)).size} categories, ${passes} pass(es)`,
    elapsedMs: Date.now() - started,
    at: deps.clock.now().toISOString(),
  });

  return { questions, passes, notes };
}

export async function generateFlashcards(
  input: { role: string; requirements: Requirement[]; existingIds?: string[]; cacheSalt?: string },
  deps: Deps,
): Promise<Flashcard[]> {
  if (!input.requirements.length) return [];
  const allocId = idAllocator('f', input.existingIds ?? []);
  const count = Math.min(14, Math.max(4, input.requirements.length * 2));

  const res = await deps.llm.complete({
    system: flashcardsPrompt.system,
    user: flashcardsPrompt.build({ role: input.role, requirements: input.requirements, count }),
    responseSchema: flashcardsSchema,
    temperature: 0.35,
    ...(input.cacheSalt ? { cacheSalt: input.cacheSalt } : {}),
  });

  const parsed = parseJson(res.text, RawFlashcards);
  if (!parsed.ok) {
    deps.logger.warn('flashcard generation returned unreadable JSON', { error: parsed.error });
    return [];
  }
  const validIds = new Set(input.requirements.map((r) => r.id));
  return (parsed.value.flashcards ?? [])
    .map((raw) => ({
      id: allocId(),
      front: truncateAtSentence(raw.front.trim(), 300).text,
      back: truncateAtSentence((raw.back ?? '').trim(), 800).text,
      requirement_ids: [...new Set((raw.requirement_ids ?? []).filter((id) => validIds.has(id)))].slice(0, 3),
      meta: { origin: 'generated' as const, pinned: false, updated_at: deps.clock.now().toISOString() },
    }))
    .filter((f) => f.front.length > 0);
}
