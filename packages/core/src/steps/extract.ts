import { z } from 'zod';
import type { KitNote, Requirement } from '@prepkit/schema';
import type { Deps } from '../ports.js';
import { note } from '../notes.js';
import { extractPrompt, extractSchema } from '../prompts/index.js';
import { parseJson } from '../resilience/json.js';
import { clampText } from '../security/sanitize.js';
import { applyPriorityHeuristics, findHeading } from './priority-heuristics.js';

/**
 * S1 — extractRoleFromJd. PLAN.md §4.3 S1.
 *
 * Owns EVERY Appendix-A field derivable from the JD, not just requirements: title,
 * seniority, location, responsibilities and the company name candidate. These are required
 * fields, so leaving them unowned would fail validateKit.
 *
 * 20 of the 55 automated points: "the must-haves in each description are found, marked
 * correctly, and nothing is invented".
 */

export const MAX_JD_CHARS = 24_000;
const THIN_JD_CHARS = 400;
const THIN_JD_REQUIREMENTS = 2;

export interface RoleExtraction {
  title: string;
  seniority: string;
  location: string;
  companyFromJd: string;
  responsibilities: string[];
  requirements: Requirement[];
  notes: KitNote[];
  /** Reported so the UI can show "3 of 11 dropped as unsupported". */
  droppedInvented: number;
}

/**
 * Deliberately permissive: the model's reply is normalised in code below, not by clever
 * schema combinators. `.catch()`/`.default()` infer as `unknown` under
 * exactOptionalPropertyTypes, and a schema you cannot read is not a safety net.
 */
const RawExtraction = z.object({
  title: z.string().optional(),
  seniority: z.string().optional(),
  location: z.string().optional(),
  company_from_jd: z.string().optional(),
  responsibilities: z.array(z.string()).optional(),
  requirements: z
    .array(
      z.object({
        text: z.string().min(1),
        kind: z.string().optional(),
        priority: z.string().optional(),
        source_span: z.string().optional(),
      }),
    )
    .optional(),
});

const asKind = (v: string | undefined): Requirement['kind'] =>
  v === 'behavioural' || v === 'domain' ? v : 'technical';
const asPriority = (v: string | undefined): Requirement['priority'] => (v === 'nice' ? 'nice' : 'must');

/**
 * Normalisation returns an index map so provenance offsets refer to the ORIGINAL jd.
 * Without the map, start/end point into a string the user never sees and the UI highlight
 * lands on the wrong words.
 */
export interface NormalizedJd {
  text: string;
  /** normalized index -> original index */
  map: number[];
  original: string;
}

export function normalizeJd(jd: string): NormalizedJd {
  const original = jd;
  const map: number[] = [];
  let text = '';
  let lastWasSpace = false;

  for (let i = 0; i < original.length; i++) {
    const ch = original[i]!;
    const isSpace = /\s/.test(ch);
    if (isSpace) {
      if (lastWasSpace) continue;
      text += ' ';
      map.push(i);
      lastWasSpace = true;
      continue;
    }
    text += ch;
    map.push(i);
    lastWasSpace = false;
    if (text.length >= MAX_JD_CHARS) break;
  }
  return { text: text.trim(), map, original };
}

/** Case- and whitespace-insensitive locate, returning ORIGINAL offsets. */
export function locateSpan(span: string, jd: NormalizedJd): { start: number; end: number } | null {
  const needle = span.replace(/\s+/g, ' ').trim().toLowerCase();
  if (needle.length < 4) return null;
  const hay = jd.text.toLowerCase();
  const at = hay.indexOf(needle);
  if (at === -1) return null;
  const start = jd.map[at] ?? 0;
  const endIdx = Math.min(at + needle.length - 1, jd.map.length - 1);
  const end = (jd.map[endIdx] ?? start) + 1;
  return { start, end };
}

export async function extractRoleFromJd(jd: string, deps: Deps): Promise<RoleExtraction> {
  const started = Date.now();
  deps.progress.step({ step: 'extract', status: 'start', at: deps.clock.now().toISOString() });

  const normalized = normalizeJd(jd);
  const notes: KitNote[] = [];

  if (!normalized.text.trim()) {
    deps.progress.step({ step: 'extract', status: 'failed', detail: 'empty job description', at: deps.clock.now().toISOString() });
    throw Object.assign(new Error('The job description is empty.'), { code: 'EXTRACTION_EMPTY' });
  }

  const res = await deps.llm.complete({
    system: extractPrompt.system,
    user: extractPrompt.build(clampText(normalized.text, MAX_JD_CHARS)),
    responseSchema: extractSchema,
    temperature: 0.1,
  });

  const parsed = parseJson(res.text, RawExtraction);
  if (!parsed.ok) {
    deps.progress.step({ step: 'extract', status: 'failed', detail: parsed.error, at: deps.clock.now().toISOString() });
    throw Object.assign(new Error(`Could not read the extracted requirements: ${parsed.error}`), {
      code: 'EXTRACTION_EMPTY',
    });
  }

  // --- the anti-invention guard: code, not trust -----------------------------
  const requirements: Requirement[] = [];
  let dropped = 0;
  let n = 0;

  for (const raw of parsed.value.requirements ?? []) {
    const span = raw.source_span?.trim() ?? '';
    const located = span ? locateSpan(span, normalized) : null;
    if (!located) {
      dropped++;
      continue;
    }
    const id = `r${++n}`;
    const heading = findHeading(normalized.original, located.start);
    const priority = applyPriorityHeuristics(asPriority(raw.priority), heading, raw.text);
    requirements.push({
      id,
      text: clampText(raw.text, 400),
      kind: asKind(raw.kind),
      priority,
      provenance: {
        source_span: normalized.original.slice(located.start, located.end),
        start: located.start,
        end: located.end,
        ...(heading ? { heading } : {}),
      },
    });
  }

  if (dropped > 0) {
    deps.logger.warn('dropped requirements with unverifiable spans', { dropped });
  }

  // --- honest thinness ------------------------------------------------------
  const thin = normalized.original.trim().length < THIN_JD_CHARS || requirements.length <= THIN_JD_REQUIREMENTS;
  if (thin) {
    notes.push(
      note('THIN_JD', {
        jd_chars: normalized.original.trim().length,
        requirements_found: requirements.length,
        dropped_unverifiable: dropped,
      }),
    );
  }

  const out: RoleExtraction = {
    title: clampText(parsed.value.title ?? '', 120),
    seniority: clampText(parsed.value.seniority ?? '', 40),
    location: clampText(parsed.value.location ?? '', 80),
    companyFromJd: clampText(parsed.value.company_from_jd ?? '', 80),
    responsibilities: (parsed.value.responsibilities ?? []).slice(0, 12).map((r) => clampText(r, 200)).filter(Boolean),
    requirements,
    notes,
    droppedInvented: dropped,
  };

  deps.progress.step({
    step: 'extract',
    status: 'ok',
    detail: `${requirements.length} requirements (${requirements.filter((r) => r.priority === 'must').length} must)${
      dropped ? `, ${dropped} dropped as unverifiable` : ''
    }`,
    elapsedMs: Date.now() - started,
    at: deps.clock.now().toISOString(),
  });
  return out;
}
