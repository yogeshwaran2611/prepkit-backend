/**
 * PLAN.md §10.5 — practice ordering. PURE.
 * Defended choice: full SM-2 without a long-term history is theatre. Confidence-weighted
 * ordering plus a simple interval is honest, testable, and does the job the brief asks for
 * ("order the next session by what they were least confident about").
 */

export type Confidence = 1 | 2 | 3;

export interface PracticeEvent {
  cardId: string;
  confidence: Confidence;
  at: string;
}

/** Intervals in days, indexed by confidence. Low confidence comes back tomorrow. */
const INTERVAL_DAYS: Record<Confidence, number[]> = {
  1: [1, 1, 2],
  2: [2, 4, 7],
  3: [4, 9, 21],
};

export function nextReviewAt(history: PracticeEvent[], confidence: Confidence, from = new Date()): Date {
  const streak = countTrailingConfident(history, confidence);
  const ladder = INTERVAL_DAYS[confidence];
  const days = ladder[Math.min(streak, ladder.length - 1)]!;
  return new Date(from.getTime() + days * 86_400_000);
}

function countTrailingConfident(history: PracticeEvent[], confidence: Confidence): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.confidence >= confidence) n++;
    else break;
  }
  return n;
}

export interface CardState {
  cardId: string;
  seen: number;
  lastConfidence?: Confidence;
  lastSeenAt?: string;
  dueAt?: string;
}

export function cardStates(cardIds: string[], events: PracticeEvent[]): CardState[] {
  const byCard = new Map<string, PracticeEvent[]>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const list = byCard.get(e.cardId) ?? [];
    list.push(e);
    byCard.set(e.cardId, list);
  }
  return cardIds.map((cardId) => {
    const hist = byCard.get(cardId) ?? [];
    const last = hist.at(-1);
    if (!last) return { cardId, seen: 0 };
    return {
      cardId,
      seen: hist.length,
      lastConfidence: last.confidence,
      lastSeenAt: last.at,
      dueAt: nextReviewAt(hist, last.confidence, new Date(last.at)).toISOString(),
    };
  });
}

/**
 * Session order: never-seen first (you cannot be confident about what you have not read),
 * then overdue, then least confident, then oldest. Deterministic — same input, same order.
 */
export function orderSession(cardIds: string[], events: PracticeEvent[], now = new Date()): string[] {
  const states = cardStates(cardIds, events);
  const score = (s: CardState): number => {
    if (s.seen === 0) return -1000;
    const overdueMs = s.dueAt ? now.getTime() - new Date(s.dueAt).getTime() : 0;
    const overdueDays = overdueMs / 86_400_000;
    return (s.lastConfidence ?? 1) * 10 - Math.max(0, overdueDays);
  };
  return [...states]
    .sort((a, b) => {
      const d = score(a) - score(b);
      if (d !== 0) return d;
      const at = (a.lastSeenAt ?? '') + a.cardId;
      const bt = (b.lastSeenAt ?? '') + b.cardId;
      return at.localeCompare(bt, 'en');
    })
    .map((s) => s.cardId);
}

export interface PracticeProgress {
  total: number;
  covered: number;
  confident: number;
  dueNow: number;
}

export function practiceProgress(cardIds: string[], events: PracticeEvent[], now = new Date()): PracticeProgress {
  const states = cardStates(cardIds, events);
  return {
    total: states.length,
    covered: states.filter((s) => s.seen > 0).length,
    confident: states.filter((s) => (s.lastConfidence ?? 0) >= 3).length,
    dueNow: states.filter((s) => s.seen > 0 && s.dueAt && new Date(s.dueAt) <= now).length,
  };
}
