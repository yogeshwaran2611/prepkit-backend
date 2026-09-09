import type { Kit, Question, Requirement } from '@prepkit/schema';
import { cardStates, type PracticeEvent } from './srs.js';
import { allocateSchedule } from './schedule.js';

/**
 * THE CREATIVE FEATURE (PLAN.md §10.5).
 *
 * The real problem: people practise what they already know. You flip through 40 cards, feel
 * productive, and never notice you have failed the same must-have requirement four times.
 *
 * Why it ranks REQUIREMENTS rather than cards: the interviewer does not ask your flashcard,
 * they ask about the requirement. Card-level stats tell you which card you flunked;
 * requirement-level tells you what to actually go and study.
 *
 * Why it is cheap: it joins data the kit already has (requirements, questions, coverage)
 * with the one new signal practice mode produces (confidence). ~40 lines of joining, and it
 * reuses allocateSchedule for the drill plan rather than inventing a second scheduler.
 */

export interface WeakSpot {
  requirement_id: string;
  text: string;
  priority: 'must' | 'nice';
  kind: Requirement['kind'];
  /** 0..100, higher = less ready. */
  risk: number;
  /** Why it scored: shown in the UI so the number is never a black box. */
  reasons: string[];
  question_ids: string[];
  flashcard_ids: string[];
  cardsSeen: number;
  cardsTotal: number;
  averageConfidence: number | null;
  hardestDifficulty: number;
}

export interface WeakSpotsReport {
  spots: WeakSpot[];
  practisedCards: number;
  totalCards: number;
  /** True when there is no practice data yet, so the UI shows guidance not a fake ranking. */
  coldStart: boolean;
}

export function weakSpots(kit: Kit, events: PracticeEvent[]): WeakSpotsReport {
  const states = new Map(cardStates(kit.flashcards.map((f) => f.id), events).map((s) => [s.cardId, s]));
  const practisedCards = [...states.values()].filter((s) => s.seen > 0).length;
  const coldStart = practisedCards === 0;

  const spots: WeakSpot[] = kit.role.requirements.map((req) => {
    const questions = kit.questions.filter((q) => q.requirement_ids.includes(req.id));
    const cards = kit.flashcards.filter((f) => f.requirement_ids.includes(req.id));
    const cardStatesForReq = cards.map((c) => states.get(c.id)).filter((s): s is NonNullable<typeof s> => !!s);
    const seen = cardStatesForReq.filter((s) => s.seen > 0);
    const confidences = seen.map((s) => s.lastConfidence ?? 1);
    const averageConfidence = confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;
    const hardestDifficulty = questions.reduce((max, q) => Math.max(max, q.difficulty), 0);

    const reasons: string[] = [];
    let risk = 0;

    // 1. Priority — a must-have you are shaky on is the thing that ends the interview.
    if (req.priority === 'must') {
      risk += 30;
      reasons.push('Marked must-have in the posting');
    } else {
      risk += 8;
    }

    // 2. Confidence — the signal only practice mode can provide.
    if (averageConfidence === null) {
      if (cards.length > 0) {
        risk += 25;
        reasons.push('Never practised');
      }
    } else if (averageConfidence < 1.6) {
      risk += 30;
      reasons.push(`Low confidence when practised (${averageConfidence.toFixed(1)} of 3)`);
    } else if (averageConfidence < 2.4) {
      risk += 15;
      reasons.push(`Middling confidence (${averageConfidence.toFixed(1)} of 3)`);
    } else {
      reasons.push(`Confident so far (${averageConfidence.toFixed(1)} of 3)`);
    }

    // 3. Difficulty — hard questions against a shaky requirement compound the risk.
    if (hardestDifficulty >= 3) {
      risk += 12;
      reasons.push('Has a hard (level 3) question against it');
    } else if (hardestDifficulty === 2) {
      risk += 6;
    }

    // 4. Coverage — nothing to practise is itself a gap worth surfacing.
    if (!questions.length) {
      risk += 20;
      reasons.push('No question covers this requirement');
    }
    if (!cards.length) {
      risk += 10;
      reasons.push('No flashcard covers this requirement');
    }
    if (kit.coverage.uncovered_requirement_ids.includes(req.id)) {
      risk += 10;
      reasons.push('Reported uncovered by the coverage check');
    }

    return {
      requirement_id: req.id,
      text: req.text,
      priority: req.priority,
      kind: req.kind,
      risk: Math.min(100, risk),
      reasons,
      question_ids: questions.map((q) => q.id),
      flashcard_ids: cards.map((c) => c.id),
      cardsSeen: seen.length,
      cardsTotal: cards.length,
      averageConfidence,
      hardestDifficulty,
    };
  });

  spots.sort(
    (a, b) =>
      b.risk - a.risk ||
      (a.priority === b.priority ? 0 : a.priority === 'must' ? -1 : 1) ||
      a.requirement_id.localeCompare(b.requirement_id, 'en'),
  );

  return { spots, practisedCards, totalCards: kit.flashcards.length, coldStart };
}

/**
 * "Build a focused plan from my weak spots" — reuses the real scheduler rather than
 * inventing a second one, so the drill plan obeys the same invariants as the main schedule.
 */
export function weakSpotPlan(kit: Kit, events: PracticeEvent[], days = 1, topN = 5) {
  const report = weakSpots(kit, events);
  const target = report.spots.slice(0, topN);
  const ids = new Set(target.flatMap((s) => s.question_ids));
  const questions: Question[] = kit.questions.filter((q) => ids.has(q.id));
  const requirements = kit.role.requirements.filter((r) => target.some((s) => s.requirement_id === r.id));

  if (!questions.length) return { days: [], spots: target };
  return { days: allocateSchedule(questions, requirements, days).days, spots: target };
}
