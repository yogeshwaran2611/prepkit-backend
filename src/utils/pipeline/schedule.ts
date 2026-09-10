import type { Question, Requirement, ScheduleDay } from '../../schemas/index.js';

/**
 * PLAN.md §4.3 S8 — PURE, ZERO LLM. "This is arithmetic and allocation. It belongs in your
 * code, not in a prompt." Invariants (§4.3 S8, enforced by checkKitIntegrity):
 *   - exactly `daysAvailable` days, numbered 1..n
 *   - every question has exactly ONE first assignment, on a kind:'new' day
 *   - repeats appear only on kind:'review' days
 *   - every must-have requirement lands on some day
 *   - harder/higher-priority material lands earlier
 */

export const MAX_MINUTES_PER_DAY = 480;
const BASE_MINUTES: Record<1 | 2 | 3, number> = { 1: 10, 2: 18, 3: 28 };
const CATEGORY_FACTOR: Record<string, number> = {
  technical: 1,
  'system-design': 1.3,
  behavioural: 0.8,
  'company-fit': 0.7,
};
const CATEGORY_ORDER = ['technical', 'system-design', 'behavioural', 'company-fit'];
/** Spaced-repetition offsets for review days when days > material (§10.5 srs). */
const REVIEW_OFFSETS = [1, 3, 7, 14];

export interface ScheduleResult {
  days: ScheduleDay[];
  /** Set when material exceeds what the days can hold; surfaced as SCHEDULE_OVERLOADED. */
  overloaded?: { required_minutes: number; allocated_minutes: number };
}

export function questionMinutes(q: Question): number {
  const base = BASE_MINUTES[q.difficulty as 1 | 2 | 3] ?? 18;
  return Math.max(5, Math.round(base * (CATEGORY_FACTOR[q.category] ?? 1)));
}

/** must before nice, then harder first, then a stable category order. */
export function prioritySort(questions: Question[], requirements: Requirement[]): Question[] {
  const mustIds = new Set(requirements.filter((r) => r.priority === 'must').map((r) => r.id));
  const isMust = (q: Question) => q.requirement_ids.some((id) => mustIds.has(id));
  return [...questions].sort((a, b) => {
    if (isMust(a) !== isMust(b)) return isMust(a) ? -1 : 1;
    if (a.difficulty !== b.difficulty) return b.difficulty - a.difficulty;
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id, 'en');
  });
}

export function allocateSchedule(
  questions: Question[],
  requirements: Requirement[],
  daysAvailable: number,
): ScheduleResult {
  const days = Math.max(1, Math.min(60, Math.trunc(daysAvailable)));
  const ordered = prioritySort(questions, requirements);

  if (!ordered.length) {
    return {
      days: Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        focus: 'No questions yet — regenerate a section to fill this schedule',
        question_ids: [],
        minutes: 0,
        kind: 'new' as const,
      })),
    };
  }

  const totalMinutes = ordered.reduce((a, q) => a + questionMinutes(q), 0);
  // Front-load: day 1 gets the largest share, decaying linearly. Weight sums to newDays.
  const newDays = Math.min(days, ordered.length);
  const weights = Array.from({ length: newDays }, (_, i) => 1 + (0.5 * (newDays - 1 - i)) / Math.max(1, newDays - 1));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const targets = weights.map((w) => (totalMinutes * w) / weightSum);

  const buckets: Question[][] = Array.from({ length: newDays }, () => []);
  const spent = new Array<number>(newDays).fill(0);

  // Greedy: walk questions hardest-first, place each in the earliest day still under target.
  // Guarantees one first assignment per question and keeps hard material early.
  for (const q of ordered) {
    const cost = questionMinutes(q);
    let idx = buckets.findIndex((_, i) => spent[i]! + cost <= targets[i]!);
    if (idx === -1) {
      // Everything at target: put it in the least-loaded day, earliest wins ties.
      idx = spent.reduce((best, v, i) => (v < spent[best]! ? i : best), 0);
    }
    buckets[idx]!.push(q);
    spent[idx] = spent[idx]! + cost;
  }

  const out: ScheduleDay[] = buckets.map((qs, i) => {
    const raw = qs.reduce((a, q) => a + questionMinutes(q), 0);
    return {
      day: i + 1,
      focus: focusFor(qs, requirements),
      question_ids: qs.map((q) => q.id),
      minutes: Math.min(raw, MAX_MINUTES_PER_DAY),
      kind: 'new' as const,
    };
  });

  // days > material: remaining days become real review days, never 0-minute filler.
  for (let d = newDays; d < days; d++) {
    const offset = REVIEW_OFFSETS[(d - newDays) % REVIEW_OFFSETS.length]!;
    const src = out[Math.max(0, d - newDays - offset + newDays - 1) % newDays] ?? out[0]!;
    const ids = src.question_ids.slice(0, 6);
    out.push({
      day: d + 1,
      focus: ids.length ? `Review: ${stripPrefix(src.focus)}` : 'Review and consolidate',
      question_ids: ids,
      minutes: Math.min(
        ids.reduce((a, id) => a + Math.round((questionMinutes(byId(ordered, id)) ?? 10) / 2), 0),
        MAX_MINUTES_PER_DAY,
      ),
      kind: 'review' as const,
    });
  }

  const allocated = out.reduce((a, d) => a + d.minutes, 0);
  const requiredNew = out.filter((d) => d.kind === 'new').reduce((a, d) => a + d.minutes, 0);
  const overloaded =
    totalMinutes > requiredNew
      ? { required_minutes: totalMinutes, allocated_minutes: requiredNew }
      : undefined;

  const result: ScheduleResult = { days: out };
  if (overloaded) result.overloaded = overloaded;
  void allocated;
  return result;
}

function byId(questions: Question[], id: string): Question {
  return questions.find((q) => q.id === id) ?? questions[0]!;
}
const stripPrefix = (s: string) => s.replace(/^Review:\s*/, '');

/** Focus is derived in code from the day's dominant requirement/category. */
function focusFor(qs: Question[], requirements: Requirement[]): string {
  if (!qs.length) return 'Review and consolidate';
  const counts = new Map<string, number>();
  for (const q of qs) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  const category = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];

  const reqCounts = new Map<string, number>();
  for (const q of qs) for (const id of q.requirement_ids) reqCounts.set(id, (reqCounts.get(id) ?? 0) + 1);
  const topReq = [...reqCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const req = requirements.find((r) => r.id === topReq);

  const label: Record<string, string> = {
    technical: 'Technical depth',
    'system-design': 'System design',
    behavioural: 'Behavioural stories',
    'company-fit': 'Company fit',
  };
  const head = label[category] ?? 'Preparation';
  if (!req) return head;
  const topic = req.text.replace(/^(nice to have|bonus)[:\s-]*/i, '').split(/[,.(]/)[0]!.trim();
  return topic.length > 3 ? `${head}: ${topic.slice(0, 60)}` : head;
}

/**
 * §5.1 — the schedule is derived, but derived is not disposable. Recompute only what the
 * change invalidates: drop dead ids, insert new ones, and NEVER touch a day the user edited.
 */
export function reconcileSchedule(
  existing: ScheduleDay[],
  questions: Question[],
  requirements: Requirement[],
): { days: ScheduleDay[]; reconciled: boolean } {
  const live = new Set(questions.map((q) => q.id));
  let changed = false;

  const days = existing.map((d) => {
    const kept = d.question_ids.filter((id) => live.has(id));
    if (kept.length !== d.question_ids.length) changed = true;
    return { ...d, question_ids: kept };
  });

  const placed = new Set(days.flatMap((d) => d.question_ids));
  const missing = prioritySort(questions.filter((q) => !placed.has(q.id)), requirements);

  if (missing.length) {
    changed = true;
    // Frozen days (user-edited) may only lose dead ids, never gain new ones.
    const open = days.filter((d) => d.kind !== 'review' && (!d.meta || d.meta.origin === 'generated'));
    const targets = open.length ? open : days.filter((d) => !d.meta || d.meta.origin === 'generated');
    if (targets.length) {
      missing.forEach((q, i) => targets[i % targets.length]!.question_ids.push(q.id));
    } else {
      // Every day is frozen: append to the earliest day rather than drop a must-have.
      days[0]!.question_ids.push(...missing.map((q) => q.id));
    }
  }

  const out = days.map((d) => {
    const qs = d.question_ids.map((id) => questions.find((q) => q.id === id)).filter((q): q is Question => !!q);
    const minutes = Math.min(
      qs.reduce((a, q) => a + (d.kind === 'review' ? Math.round(questionMinutes(q) / 2) : questionMinutes(q)), 0),
      MAX_MINUTES_PER_DAY,
    );
    // A frozen day keeps its focus verbatim; a generated one may be relabelled.
    const focus = d.meta && d.meta.origin !== 'generated' ? d.focus : d.kind === 'review' ? d.focus : focusFor(qs, requirements);
    return { ...d, minutes, focus };
  });

  return { days: out, reconciled: changed };
}
