import { describe, expect, it } from 'vitest';
import { checkKitIntegrity } from '../../schemas/index.js';
import type { Kit, Question, Requirement } from '../../schemas/index.js';
import { MAX_MINUTES_PER_DAY, allocateSchedule, questionMinutes, reconcileSchedule } from './schedule.js';

const req = (i: number, priority: 'must' | 'nice' = 'must'): Requirement => ({
  id: `r${i}`,
  text: `Requirement number ${i} about Postgres and Node`,
  kind: 'technical',
  priority,
});

const q = (i: number, difficulty: 1 | 2 | 3 = 2, reqId = 'r1', category: Question['category'] = 'technical'): Question => ({
  id: `q${i}`,
  requirement_ids: [reqId],
  category,
  prompt: `Question ${i} about Postgres`,
  answer_outline: 'outline',
  difficulty,
});

/** The invariants the brief states, checked through the real integrity checker. */
const asKit = (questions: Question[], requirements: Requirement[], days: number): Kit => {
  const { days: sched } = allocateSchedule(questions, requirements, days);
  return {
    source: { company: 'A', company_url: 'u', role: 'r', location: '', jd_chars: 1, researched_at: 'now', pages_used: [] },
    company_brief: { summary: '', what_they_do: '', sources: [] },
    role: { title: '', seniority: '', responsibilities: [], requirements },
    questions,
    flashcards: [],
    schedule: { days_available: days, days: sched },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
};

describe('allocateSchedule', () => {
  it('produces exactly the number of days requested', () => {
    for (const d of [1, 2, 3, 5, 7, 14, 30, 60]) {
      const { days } = allocateSchedule([q(1), q(2), q(3), q(4), q(5)], [req(1)], d);
      expect(days).toHaveLength(d);
      expect(days.map((x) => x.day)).toEqual(Array.from({ length: d }, (_, i) => i + 1));
    }
  });

  it('clamps out-of-range day counts instead of emitting a broken schedule', () => {
    expect(allocateSchedule([q(1)], [req(1)], 0).days).toHaveLength(1);
    expect(allocateSchedule([q(1)], [req(1)], 999).days).toHaveLength(60);
  });

  it('assigns every question exactly one first assignment on a new day', () => {
    const questions = Array.from({ length: 17 }, (_, i) => q(i + 1));
    const { days } = allocateSchedule(questions, [req(1)], 4);
    const firstAssignments = days
      .filter((d) => d.kind === 'new')
      .flatMap((d) => d.question_ids);
    expect(new Set(firstAssignments).size).toBe(17);
    expect(firstAssignments).toHaveLength(17);
  });

  it('satisfies the real integrity checker across many shapes', () => {
    for (const [nq, nd] of [[1, 1], [5, 1], [3, 7], [20, 3], [7, 60], [40, 12]] as const) {
      const questions = Array.from({ length: nq }, (_, i) => q(i + 1, ((i % 3) + 1) as 1 | 2 | 3));
      const kit = asKit(questions, [req(1)], nd);
      expect(checkKitIntegrity(kit), `nq=${nq} nd=${nd}`).toEqual([]);
    }
  });

  it('days=1 holds everything and caps minutes rather than emitting an absurd day', () => {
    const questions = Array.from({ length: 200 }, (_, i) => q(i + 1, 3));
    const r = allocateSchedule(questions, [req(1)], 1);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]!.question_ids).toHaveLength(200);
    expect(r.days[0]!.minutes).toBe(MAX_MINUTES_PER_DAY);
    expect(r.overloaded).toBeDefined();
    expect(r.overloaded!.required_minutes).toBeGreaterThan(MAX_MINUTES_PER_DAY);
  });

  it('days=60 with little material makes real review days, never 0-minute filler', () => {
    const questions = Array.from({ length: 8 }, (_, i) => q(i + 1));
    const { days } = allocateSchedule(questions, [req(1)], 60);
    expect(days).toHaveLength(60);
    const review = days.filter((d) => d.kind === 'review');
    expect(review).toHaveLength(52);
    for (const d of review) {
      expect(d.question_ids.length).toBeGreaterThan(0);
      expect(d.minutes).toBeGreaterThan(0);
      expect(d.focus).not.toBe('');
    }
  });

  it('front-loads: day 1 is harder and busier than the last new day', () => {
    const questions = [
      ...Array.from({ length: 6 }, (_, i) => q(i + 1, 3)),
      ...Array.from({ length: 6 }, (_, i) => q(i + 7, 1)),
    ];
    const { days } = allocateSchedule(questions, [req(1)], 4);
    const diff = (d: (typeof days)[number]) =>
      d.question_ids.map((id) => questions.find((x) => x.id === id)!.difficulty).reduce((a, b) => a + b, 0) /
      Math.max(1, d.question_ids.length);
    expect(diff(days[0]!)).toBeGreaterThan(diff(days[3]!));
  });

  it('puts must-have material before nice-to-have material', () => {
    const questions = [q(1, 1, 'r2'), q(2, 1, 'r2'), q(3, 1, 'r1'), q(4, 1, 'r1')];
    const { days } = allocateSchedule(questions, [req(1, 'must'), req(2, 'nice')], 2);
    expect(days[0]!.question_ids).toEqual(expect.arrayContaining(['q3', 'q4']));
  });

  it('emits integer minutes only', () => {
    const questions = Array.from({ length: 13 }, (_, i) => q(i + 1, ((i % 3) + 1) as 1 | 2 | 3, 'r1', 'system-design'));
    const { days } = allocateSchedule(questions, [req(1)], 5);
    for (const d of days) expect(Number.isInteger(d.minutes)).toBe(true);
  });

  it('is deterministic', () => {
    const questions = Array.from({ length: 25 }, (_, i) => q(i + 1, ((i % 3) + 1) as 1 | 2 | 3));
    const a = allocateSchedule(questions, [req(1)], 6);
    const b = allocateSchedule(questions, [req(1)], 6);
    expect(a).toEqual(b);
  });

  it('handles an empty question bank without breaking the day count', () => {
    const { days } = allocateSchedule([], [req(1)], 3);
    expect(days).toHaveLength(3);
    expect(days.every((d) => d.minutes === 0)).toBe(true);
  });

  it('derives a focus string that names the topic', () => {
    const { days } = allocateSchedule([q(1), q(2)], [req(1)], 1);
    expect(days[0]!.focus).toMatch(/Technical depth/);
    expect(days[0]!.focus).toMatch(/Postgres/);
  });
});

describe('questionMinutes', () => {
  it('scales with difficulty and weights system design heaviest', () => {
    expect(questionMinutes(q(1, 1))).toBeLessThan(questionMinutes(q(2, 3)));
    expect(questionMinutes(q(3, 2, 'r1', 'system-design'))).toBeGreaterThan(questionMinutes(q(4, 2, 'r1', 'behavioural')));
  });
});

describe('reconcileSchedule (§5.1 — derived is not disposable)', () => {
  const questions = [q(1), q(2), q(3), q(4)];
  const requirements = [req(1)];

  it('removes ids for questions that no longer exist', () => {
    const { days } = allocateSchedule(questions, requirements, 2);
    const remaining = questions.filter((x) => x.id !== 'q2');
    const r = reconcileSchedule(days, remaining, requirements);
    expect(r.days.flatMap((d) => d.question_ids)).not.toContain('q2');
    expect(r.reconciled).toBe(true);
  });

  it('inserts new questions without changing day count or day order', () => {
    const { days } = allocateSchedule(questions, requirements, 3);
    const withNew = [...questions, q(9)];
    const r = reconcileSchedule(days, withNew, requirements);
    expect(r.days).toHaveLength(3);
    expect(r.days.map((d) => d.day)).toEqual([1, 2, 3]);
    expect(r.days.flatMap((d) => d.question_ids)).toContain('q9');
  });

  it('NEVER adds to or relabels a user-edited (frozen) day', () => {
    const { days } = allocateSchedule(questions, requirements, 3);
    days[1] = { ...days[1]!, focus: 'My own plan for Tuesday', meta: { origin: 'edited', pinned: false, updated_at: 'now' } };
    const before = [...days[1]!.question_ids];
    const r = reconcileSchedule(days, [...questions, q(9), q(10)], requirements);
    expect(r.days[1]!.focus).toBe('My own plan for Tuesday');
    expect(r.days[1]!.question_ids).toEqual(before);
  });

  it('still removes dead ids from a frozen day — a stale reference is worse than a rewrite', () => {
    const { days } = allocateSchedule(questions, requirements, 2);
    const target = days.findIndex((d) => d.question_ids.includes('q1'));
    days[target] = { ...days[target]!, meta: { origin: 'edited', pinned: false, updated_at: 'now' } };
    const r = reconcileSchedule(days, questions.filter((x) => x.id !== 'q1'), requirements);
    expect(r.days[target]!.question_ids).not.toContain('q1');
  });

  it('never leaves a question unscheduled, even when every day is frozen', () => {
    const { days } = allocateSchedule(questions, requirements, 2);
    const frozen = days.map((d) => ({ ...d, meta: { origin: 'edited' as const, pinned: false, updated_at: 'now' } }));
    const r = reconcileSchedule(frozen, [...questions, q(42)], requirements);
    expect(r.days.flatMap((d) => d.question_ids)).toContain('q42');
  });
});
