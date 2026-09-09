import { describe, expect, it } from 'vitest';
import type { Kit, Question } from '@prepkit/schema';
import { validateKit } from '@prepkit/schema';
import { allocateSchedule, markEdited, markManual } from '@prepkit/core';
import { mergeQuestionSection, summarizeMerge } from './job-runner.js';

/**
 * The §5 merge, tested without a queue, a database, or a model — this is the 15-point
 * behaviour and it should not require a running server to verify.
 */

const question = (id: string, category: Question['category'], prompt = `prompt ${id}`): Question => ({
  id,
  requirement_ids: ['r1'],
  category,
  prompt,
  answer_outline: 'outline',
  difficulty: 2,
  meta: { origin: 'generated', pinned: false, updated_at: '2026-01-01T00:00:00.000Z' },
});

function baseKit(): Kit {
  const questions = [
    question('q1', 'technical'),
    question('q2', 'technical'),
    question('q3', 'behavioural'),
    question('q4', 'system-design'),
  ];
  const requirements = [
    { id: 'r1', text: 'Node.js services in production', kind: 'technical' as const, priority: 'must' as const },
  ];
  return {
    source: { company: 'Acme', company_url: 'http://x/', role: 'Engineer', location: '', jd_chars: 100, researched_at: 'now', pages_used: [] },
    company_brief: { summary: 's', what_they_do: 'w', sources: [] },
    role: { title: 'Engineer', seniority: 'senior', responsibilities: [], requirements },
    questions,
    flashcards: [],
    schedule: { days_available: 3, days: allocateSchedule(questions, requirements, 3).days },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    order: { questions: questions.map((q) => q.id) },
  };
}

const fresh = (prompt: string): Question => ({ ...question('PLACEHOLDER', 'technical', prompt) });

describe('mergeQuestionSection', () => {
  it('replaces unpinned generated questions in the target category only', () => {
    const kit = baseKit();
    const out = mergeQuestionSection(kit, 'technical', [fresh('new A'), fresh('new B')]);

    expect(out.questions.filter((q) => q.category === 'behavioural')).toEqual(
      kit.questions.filter((q) => q.category === 'behavioural'),
    );
    expect(out.questions.filter((q) => q.category === 'system-design')).toEqual(
      kit.questions.filter((q) => q.category === 'system-design'),
    );
    expect(out.questions.map((q) => q.prompt)).toContain('new A');
    expect(out.questions.map((q) => q.id)).not.toContain('q1');
  });

  it('keeps an edited question and a hand-written one, byte for byte', () => {
    const kit = baseKit();
    const edited = markEdited({ ...kit.questions[0]!, prompt: 'MY EDIT' });
    const manual = markManual(question('q9', 'technical', 'MY OWN'));
    kit.questions = [edited, manual, ...kit.questions.slice(1)];
    kit.order = { questions: kit.questions.map((q) => q.id) };

    const out = mergeQuestionSection(kit, 'technical', [fresh('replacement')]);
    expect(out.questions.find((q) => q.id === edited.id)).toEqual(edited);
    expect(out.questions.find((q) => q.id === 'q9')).toEqual(manual);
  });

  it('keeps a pinned generated question', () => {
    const kit = baseKit();
    kit.questions[0]!.meta = { origin: 'generated', pinned: true, updated_at: 'x' };
    const out = mergeQuestionSection(kit, 'technical', [fresh('replacement')]);
    expect(out.questions.some((q) => q.id === 'q1' && q.meta?.pinned)).toBe(true);
  });

  it('preserves the user’s ordering of surviving questions', () => {
    const kit = baseKit();
    kit.questions = [markManual(question('q7', 'technical', 'first')), markManual(question('q8', 'technical', 'second')), ...kit.questions];
    kit.order = { questions: ['q8', 'q7', 'q1', 'q2', 'q3', 'q4'] };
    const out = mergeQuestionSection(kit, 'technical', [fresh('new')]);
    const order = out.order?.questions ?? [];
    expect(order.indexOf('q8')).toBeLessThan(order.indexOf('q7'));
  });

  it('never leaves a schedule entry pointing at a deleted question', () => {
    const kit = baseKit();
    const out = mergeQuestionSection(kit, 'technical', [fresh('new A')]);
    const ids = new Set(out.questions.map((q) => q.id));
    for (const day of out.schedule.days) {
      for (const id of day.question_ids) expect(ids.has(id)).toBe(true);
    }
  });

  it('keeps the day count and passes full validation afterwards', () => {
    const kit = baseKit();
    const out = mergeQuestionSection(kit, 'technical', [fresh('new A'), fresh('new B')]);
    expect(out.schedule.days).toHaveLength(3);
    const result = validateKit(out);
    expect(result.ok, result.ok ? '' : JSON.stringify([...result.zodErrors, ...result.issues])).toBe(true);
  });

  it('does not rewrite a day the user edited', () => {
    const kit = baseKit();
    kit.schedule.days[1] = {
      ...kit.schedule.days[1]!,
      focus: 'MY OWN PLAN',
      meta: { origin: 'edited', pinned: false, updated_at: 'x' },
    };
    const before = [...kit.schedule.days[1]!.question_ids];
    const out = mergeQuestionSection(kit, 'behavioural', [fresh('new behavioural')]);
    expect(out.schedule.days[1]!.focus).toBe('MY OWN PLAN');
    // It may lose a dead id but must never gain one.
    expect(out.schedule.days[1]!.question_ids.every((id) => before.includes(id))).toBe(true);
  });
});

describe('summarizeMerge — the message shown after regenerating', () => {
  it('counts replaced, added, kept and untouched', () => {
    const kit = baseKit();
    kit.questions[0] = markEdited(kit.questions[0]!);
    const out = mergeQuestionSection(kit, 'technical', [fresh('new A')]);
    const summary = summarizeMerge(kit, out, 'technical');
    expect(summary.keptProtected).toBe(1);
    expect(summary.added).toBe(1);
    expect(summary.replaced).toBe(1);
    expect(summary.untouchedOtherCategories).toBe(2);
  });
});
