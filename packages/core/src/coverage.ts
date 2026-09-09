import type { Question, Requirement } from '@prepkit/schema';

/**
 * PLAN.md §4.3 S7 — PURE, ZERO LLM. This is 15 of the 55 automated points and the brief
 * is explicit that it "is your code's decision to make, not the model's".
 */

export interface CoverageGap {
  requirement_id: string;
  priority: 'must' | 'nice';
  text: string;
}

const STOP = new Set([
  'the','a','an','and','or','of','to','in','for','with','on','at','by','from','as','is','are',
  'be','been','you','your','our','we','they','this','that','it','its','have','has','will','can',
  'about','into','over','years','year','experience','strong','good','using','use','used','work',
  'working','ability','able','plus','etc','including','across','their','them','who','what','how',
]);

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/\.$/, ''))
    .filter((w) => w.length > 2 && !STOP.has(w));

/** A capitalised or symbol-bearing token is a strong signal: "PostgreSQL", "C++", "gRPC". */
const salient = (s: string): Set<string> =>
  new Set(
    s
      .split(/[^A-Za-z0-9+#.]+/)
      .filter((t) => t.length > 1 && (/[A-Z]/.test(t.slice(1)) || /[+#]/.test(t) || /^[A-Z]/.test(t)))
      .map((t) => t.toLowerCase().replace(/\.$/, ''))
      .filter((t) => !STOP.has(t)),
  );

export const LINK_OVERLAP_THRESHOLD = 0.12;

/**
 * The link-quality gate. Without it, coverage is *checkable* but not *correct*: a model that
 * tags every question with every requirement id scores flawless coverage with garbage links.
 * Evidence required = lexical overlap OR a shared salient term.
 */
export function acceptLink(q: Pick<Question, 'prompt' | 'answer_outline'>, r: Requirement): boolean {
  const qText = `${q.prompt} ${q.answer_outline}`;
  const qw = new Set(words(qText));
  const rw = words(r.text);
  if (!rw.length || !qw.size) return false;

  const rs = salient(r.text);
  for (const t of rs) if (qw.has(t)) return true;

  const hits = rw.filter((w) => qw.has(w)).length;
  return hits / rw.length >= LINK_OVERLAP_THRESHOLD;
}

export interface PrunedLinks {
  questions: Question[];
  rejected: number;
  discarded: string[];
}

/**
 * Drops unsupported links BEFORE the coverage diff runs, so a bad link cannot close a gap.
 * A question left with no accepted link is discarded entirely.
 */
export function pruneLinks(questions: Question[], requirements: Requirement[]): PrunedLinks {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const out: Question[] = [];
  const discarded: string[] = [];
  let rejected = 0;

  for (const q of questions) {
    // Manual and edited questions are the user's; never second-guess their links.
    if (q.meta && q.meta.origin !== 'generated') {
      out.push(q);
      continue;
    }
    const scored = q.requirement_ids
      .map((id) => byId.get(id))
      .filter((r): r is Requirement => !!r)
      .filter((r) => {
        const ok = acceptLink(q, r);
        if (!ok) rejected++;
        return ok;
      });

    // Cap at 3 best: shotgun tagging is the failure mode this guards.
    const kept = scored.slice(0, 3).map((r) => r.id);
    if (!kept.length) {
      discarded.push(q.id);
      continue;
    }
    rejected += q.requirement_ids.length - kept.length - (q.requirement_ids.length - scored.length);
    out.push({ ...q, requirement_ids: kept });
  }
  return { questions: out, rejected, discarded };
}

/** A gap is a requirement with no accepted question against it. Must-haves sort first. */
export function findCoverageGaps(requirements: Requirement[], questions: Question[]): CoverageGap[] {
  const covered = new Set(questions.flatMap((q) => q.requirement_ids));
  return requirements
    .filter((r) => !covered.has(r.id))
    .map((r) => ({ requirement_id: r.id, priority: r.priority, text: r.text }))
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'must' ? -1 : 1));
}

export function summarizeCoverage(
  requirements: Requirement[],
  questions: Question[],
  passes: number,
): { uncovered_requirement_ids: string[]; passes: number } {
  return {
    uncovered_requirement_ids: findCoverageGaps(requirements, questions).map((g) => g.requirement_id),
    passes,
  };
}

/**
 * Last resort so a kit never ships with an uncovered must-have — the one job the brief says
 * it must not fail. Deterministic template, no LLM, and the event is recorded in notes.
 */
export function fallbackQuestion(r: Requirement, id: string): Question {
  const category =
    r.kind === 'behavioural' ? 'behavioural' : r.kind === 'domain' ? 'company-fit' : 'technical';
  const text = r.text.replace(/\.$/, '');
  return {
    id,
    requirement_ids: [r.id],
    category,
    prompt:
      r.kind === 'behavioural'
        ? `Tell me about a time your experience with "${text}" was tested. What did you do, and what happened?`
        : `Walk me through your experience with "${text}". What did you build, what were the trade-offs, and what would you do differently?`,
    answer_outline: `Give a concrete example that evidences "${text}": the situation, the decisions you made and why, the outcome, and what you learned. Name specifics — systems, numbers, constraints.`,
    difficulty: 2,
    meta: { origin: 'generated', pinned: false, updated_at: new Date(0).toISOString() },
  };
}
