import type { KitNote, NoteCode } from '@prepkit/schema';

/**
 * Honest reporting is graded ("a thin description should produce a thin kit that says so"),
 * so notes are structured data with a human sentence, never a swallowed warning.
 */
const MESSAGES: Record<NoteCode, string> = {
  THIN_JD: 'The job description was very short, so this kit is deliberately thin rather than padded with invented requirements.',
  NO_HIRING_PAGE: 'No hiring or interview-process page was found on the company site, so the kit does not claim to know how they interview.',
  NO_PUBLIC_DISCUSSION: 'No public discussion of this company’s interview process was found.',
  COMPANY_UNREACHABLE: 'The company site could not be retrieved, so the company brief is based only on the job description.',
  ROBOTS_BLOCKED: 'Some pages were skipped because robots.txt disallows them.',
  THIN_PAGE: 'Some pages returned very little readable text (often a JavaScript-rendered site).',
  BUDGET_EXHAUSTED: 'The per-run page budget was reached, so retrieval stopped early.',
  FALLBACK_QUESTION_USED: 'A must-have requirement had no generated question, so a question was synthesised directly from the requirement text.',
  LINKS_REJECTED: 'Some generated question-to-requirement links were rejected as unsupported and did not count towards coverage.',
  SCHEDULE_OVERLOADED: 'There is more material than the available days comfortably hold, so days are capped and ordered by priority.',
  SCHEDULE_RECONCILED: 'The schedule was adjusted to keep every must-have covered after an edit or regeneration.',
  PROVIDER_FAILOVER: 'The primary model was unavailable, so a fallback model produced part of this kit.',
};

export function note(code: NoteCode, detail?: Record<string, unknown>): KitNote {
  return detail ? { code, message: MESSAGES[code], detail } : { code, message: MESSAGES[code] };
}

/** One note per code; the last detail wins. Keeps the panel readable. */
export function dedupeNotes(notes: KitNote[]): KitNote[] {
  const by = new Map<string, KitNote>();
  for (const n of notes) by.set(n.code, n);
  return [...by.values()];
}
