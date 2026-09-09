import { describe, expect, it } from 'vitest';
import { checkKitIntegrity, validateKit } from './integrity.js';
import type { Kit } from './kit.js';

const NOW = '2026-09-09T00:00:00.000Z';

/** A minimal VALID kit. Every test mutates a clone of this to trip exactly one rule. */
const base = (): Kit => ({
  source: {
    company: 'Acme',
    company_url: 'http://localhost:8099/acme/',
    role: 'Senior Backend Engineer',
    location: '',
    jd_chars: 1200,
    researched_at: NOW,
    pages_used: ['http://localhost:8099/acme/'],
  },
  company_brief: { summary: 's', what_they_do: 'w', sources: ['http://localhost:8099/acme/'] },
  role: {
    title: 'Senior Backend Engineer',
    seniority: 'senior',
    responsibilities: ['ship services'],
    requirements: [
      { id: 'r1', text: '5+ years with Node', kind: 'technical', priority: 'must' },
      { id: 'r2', text: 'Nice: Kubernetes', kind: 'technical', priority: 'nice' },
    ],
  },
  questions: [
    {
      id: 'q1',
      requirement_ids: ['r1'],
      category: 'technical',
      prompt: 'Walk through a Node service you owned.',
      answer_outline: 'scope, tradeoffs, outcome',
      difficulty: 2,
    },
    {
      id: 'q2',
      requirement_ids: ['r2'],
      category: 'technical',
      prompt: 'When would you not reach for Kubernetes?',
      answer_outline: 'operational cost',
      difficulty: 3,
    },
  ],
  flashcards: [{ id: 'f1', front: 'Event loop?', back: 'phases', requirement_ids: ['r1'] }],
  schedule: {
    days_available: 2,
    days: [
      { day: 1, focus: 'Node depth', question_ids: ['q1'], minutes: 40, kind: 'new' },
      { day: 2, focus: 'Infra', question_ids: ['q2'], minutes: 30, kind: 'new' },
    ],
  },
  coverage: { uncovered_requirement_ids: [], passes: 2 },
});

const codes = (k: Kit) => checkKitIntegrity(k).map((i) => i.code);

describe('checkKitIntegrity', () => {
  it('accepts a valid kit', () => {
    expect(checkKitIntegrity(base())).toEqual([]);
  });

  it('rejects a question referencing an unknown requirement', () => {
    const k = base();
    k.questions[0]!.requirement_ids = ['r99'];
    expect(codes(k)).toContain('UNKNOWN_REQUIREMENT_REF');
  });

  it('rejects a day referencing a question that does not exist', () => {
    const k = base();
    k.schedule.days[0]!.question_ids = ['q99'];
    expect(codes(k)).toContain('UNKNOWN_QUESTION_REF');
  });

  it('rejects a day count that differs from days_available', () => {
    const k = base();
    k.schedule.days_available = 3;
    expect(codes(k)).toContain('DAY_COUNT_MISMATCH');
  });

  it('rejects a gap in the day sequence', () => {
    const k = base();
    k.schedule.days[1]!.day = 3;
    expect(codes(k)).toContain('DAY_SEQUENCE_GAP');
  });

  it('rejects an unallocated question — the schedule must hold all of it', () => {
    const k = base();
    k.schedule.days[1]!.question_ids = [];
    expect(codes(k)).toContain('QUESTION_UNSCHEDULED');
  });

  it('rejects a must-have with no question', () => {
    const k = base();
    k.questions = k.questions.filter((q) => q.id !== 'q1');
    k.schedule.days[0]!.question_ids = [];
    expect(codes(k)).toContain('MUST_WITHOUT_QUESTION');
  });

  it('rejects a must-have reported as uncovered (fallback path should have closed it)', () => {
    const k = base();
    k.coverage.uncovered_requirement_ids = ['r1'];
    expect(codes(k)).toContain('MUST_REPORTED_UNCOVERED');
  });

  // --- the days=60 rule: repeats are legal ONLY on review days ---
  it('allows a repeat on a review day (days > material)', () => {
    const k = base();
    k.schedule.days_available = 3;
    k.schedule.days.push({
      day: 3,
      focus: 'Review: Node depth',
      question_ids: ['q1'],
      minutes: 20,
      kind: 'review',
    });
    expect(checkKitIntegrity(k)).toEqual([]);
  });

  it('rejects the same repeat on a new day', () => {
    const k = base();
    k.schedule.days_available = 3;
    k.schedule.days.push({
      day: 3,
      focus: 'More Node',
      question_ids: ['q1'],
      minutes: 20,
      kind: 'new',
    });
    expect(codes(k)).toContain('REPEAT_ON_NEW_DAY');
  });

  it('rejects a question listed twice within one day', () => {
    const k = base();
    k.schedule.days[0]!.question_ids = ['q1', 'q1'];
    expect(codes(k)).toContain('DUPLICATE_FIRST_ASSIGNMENT');
  });
});

describe('validateKit', () => {
  it('reports zod errors for a structurally wrong kit', () => {
    const r = validateKit({ nope: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.zodErrors.length).toBeGreaterThan(0);
  });

  it('rejects a float duration — minutes is an integer', () => {
    const k = base() as unknown as Record<string, any>;
    k.schedule.days[0].minutes = 42.5;
    const r = validateKit(k);
    expect(r.ok).toBe(false);
  });

  it('rejects difficulty outside 1..3', () => {
    const k = base() as unknown as Record<string, any>;
    k.questions[0].difficulty = 5;
    expect(validateKit(k).ok).toBe(false);
  });

  it('rejects shotgun tagging of more than 3 requirement_ids', () => {
    const k = base() as unknown as Record<string, any>;
    k.questions[0].requirement_ids = ['r1', 'r2', 'r1', 'r2'];
    expect(validateKit(k).ok).toBe(false);
  });

  it('defaults day kind to new so integrity can rely on it', () => {
    const k = base() as unknown as Record<string, any>;
    delete k.schedule.days[0].kind;
    const r = validateKit(k);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kit.schedule.days[0]!.kind).toBe('new');
  });
});
