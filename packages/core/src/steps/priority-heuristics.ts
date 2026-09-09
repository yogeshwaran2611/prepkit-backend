import type { RequirementPriority } from '@prepkit/schema';

/**
 * PLAN.md §4.3 S1 — "A 'required' line and a 'bonus points for' line are not the same
 * thing." The heading a requirement sits under is stronger evidence than the model's guess,
 * so the heading wins and the model is the fallback.
 */

const NICE_HEADING = /nice\s*to\s*have|bonus|preferred|desirable|plus(?:es)?\b|would\s*be\s*(?:great|nice)|advantage|optional|extra\s*credit|pluses/i;
const MUST_HEADING = /requirements?|must\s*have|minimum|essential|you\s*(?:will\s*)?need|what\s*(?:we|you).{0,20}(?:need|looking|require)|qualifications|about\s*you|who\s*you\s*are|skills\s*(?:and|&)\s*experience/i;

/** Inline phrasing, used when the heading is silent. */
const NICE_INLINE = /\b(?:nice\s*to\s*have|bonus|a\s*plus|preferred|desirable|ideally|would\s*be\s*(?:great|nice)|optional)\b/i;
const MUST_INLINE = /\b(?:must|required|essential|minimum\s*of|at\s*least|proven|demonstrated)\b/i;

/**
 * Finds the nearest preceding heading-like line for a character offset in the original JD.
 * Heading-like = a short line that is a markdown heading, ends with a colon, is title case,
 * or is all caps. Deliberately loose: postings are not well-formed documents.
 */
export function findHeading(jd: string, offset: number): string {
  const before = jd.slice(0, offset);
  const lines = before.split(/\r?\n/);
  // Skip the partial line the offset sits in.
  for (let i = lines.length - 2; i >= 0 && i > lines.length - 40; i--) {
    const line = (lines[i] ?? '').trim();
    if (!line || line.length > 80) continue;
    if (isHeadingLike(line)) return line.replace(/[#*_:]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function isHeadingLike(line: string): boolean {
  if (/^#{1,6}\s/.test(line)) return true;
  if (/^\*\*.+\*\*:?$/.test(line)) return true;
  if (line.endsWith(':') && line.length < 60) return true;
  if (line === line.toUpperCase() && /[A-Z]{3}/.test(line) && line.length < 60) return true;
  // A short line with no terminal punctuation, e.g. "Nice to have"
  if (line.length < 40 && !/[.,;!?]$/.test(line) && /^[A-Z]/.test(line) && line.split(' ').length <= 6) return true;
  return false;
}

/**
 * Heading first, then inline phrasing, then the model's guess. Returns the priority the
 * application will store — the model never gets the final say on this.
 */
export function applyPriorityHeuristics(
  modelGuess: RequirementPriority,
  heading: string,
  text: string,
): RequirementPriority {
  if (heading) {
    if (NICE_HEADING.test(heading)) return 'nice';
    if (MUST_HEADING.test(heading)) return 'must';
  }
  if (NICE_INLINE.test(text)) return 'nice';
  if (MUST_INLINE.test(text)) return 'must';
  return modelGuess;
}
