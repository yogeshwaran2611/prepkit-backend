import { describe, expect, it } from 'vitest';
import { nextReviewAt, orderSession, practiceProgress } from './srs.js';
import type { PracticeEvent } from './srs.js';

const ev = (cardId: string, confidence: 1 | 2 | 3, at: string): PracticeEvent => ({ cardId, confidence, at });
const DAY = 86_400_000;

describe('nextReviewAt', () => {
  it('brings a low-confidence card back tomorrow', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const next = nextReviewAt([], 1, from);
    expect(next.getTime() - from.getTime()).toBe(DAY);
  });

  it('pushes a confident card further out', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(nextReviewAt([], 3, from).getTime()).toBeGreaterThan(nextReviewAt([], 2, from).getTime());
    expect(nextReviewAt([], 2, from).getTime()).toBeGreaterThan(nextReviewAt([], 1, from).getTime());
  });

  it('lengthens the interval as a confident streak builds', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const once = nextReviewAt([ev('f1', 3, '2026-01-01')], 3, from);
    const thrice = nextReviewAt([ev('f1', 3, '2026-01-01'), ev('f1', 3, '2026-01-02'), ev('f1', 3, '2026-01-03')], 3, from);
    expect(thrice.getTime()).toBeGreaterThan(once.getTime());
  });
});

describe('orderSession — least confident first', () => {
  it('puts never-seen cards before anything already practised', () => {
    const order = orderSession(['f1', 'f2', 'f3'], [ev('f1', 1, '2026-01-01T00:00:00Z')]);
    expect(order.slice(0, 2)).toEqual(['f2', 'f3']);
  });

  it('orders seen cards by ascending confidence', () => {
    const events = [ev('f1', 3, '2026-01-01T00:00:00Z'), ev('f2', 1, '2026-01-01T00:00:00Z'), ev('f3', 2, '2026-01-01T00:00:00Z')];
    expect(orderSession(['f1', 'f2', 'f3'], events, new Date('2026-01-01T01:00:00Z'))).toEqual(['f2', 'f3', 'f1']);
  });

  it('uses only the latest event for a card', () => {
    const events = [ev('f1', 1, '2026-01-01T00:00:00Z'), ev('f1', 3, '2026-01-02T00:00:00Z'), ev('f2', 2, '2026-01-02T00:00:00Z')];
    expect(orderSession(['f1', 'f2'], events, new Date('2026-01-02T01:00:00Z'))).toEqual(['f2', 'f1']);
  });

  it('surfaces an overdue confident card ahead of a fresh confident one', () => {
    const events = [ev('f1', 3, '2025-11-01T00:00:00Z'), ev('f2', 3, '2026-01-01T00:00:00Z')];
    expect(orderSession(['f1', 'f2'], events, new Date('2026-01-01T02:00:00Z'))[0]).toBe('f1');
  });

  it('is deterministic and never drops or duplicates a card', () => {
    const ids = ['f1', 'f2', 'f3', 'f4', 'f5'];
    const events = [ev('f2', 2, '2026-01-01T00:00:00Z'), ev('f4', 1, '2026-01-01T00:00:00Z')];
    const a = orderSession(ids, events, new Date('2026-01-02T00:00:00Z'));
    const b = orderSession(ids, events, new Date('2026-01-02T00:00:00Z'));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([...ids].sort());
  });

  it('handles no history at all', () => {
    expect(orderSession(['f1', 'f2'], [])).toEqual(['f1', 'f2']);
  });
});

describe('practiceProgress — "show what has been covered and what has not"', () => {
  it('counts covered, confident and due', () => {
    const events = [ev('f1', 3, '2025-11-01T00:00:00Z'), ev('f2', 1, '2026-01-01T00:00:00Z')];
    const p = practiceProgress(['f1', 'f2', 'f3'], events, new Date('2026-01-05T00:00:00Z'));
    expect(p).toEqual({ total: 3, covered: 2, confident: 1, dueNow: 2 });
  });

  it('reports zero progress honestly for a fresh kit', () => {
    expect(practiceProgress(['f1', 'f2'], [])).toEqual({ total: 2, covered: 0, confident: 0, dueNow: 0 });
  });
});
