import { UNTRUSTED_NOTICE, asUntrustedBlock } from '../security/sanitize.js';
import type { QuestionCategory, Requirement } from '@prepkit/schema';

/**
 * Prompts are versioned files, and `promptVersion` is stored on every kit so a kit can be
 * explained after the prompts move on (PLAN.md §7).
 *
 * Response schemas are FLAT and per-step: Gemini's `responseSchema` is a restricted OpenAPI
 * subset (no $ref, no anyOf), so the composite Kit schema is never sent. Verified against
 * the live API by `npm run probe:schema`.
 */

export const PROMPT_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// S1 — extraction. 20 of the 55 automated points ride on this one prompt.
// ---------------------------------------------------------------------------

export const extractSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    seniority: { type: 'string' },
    location: { type: 'string' },
    company_from_jd: { type: 'string' },
    responsibilities: { type: 'array', items: { type: 'string' } },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['technical', 'behavioural', 'domain'] },
          priority: { type: 'string', enum: ['must', 'nice'] },
          source_span: { type: 'string' },
        },
        required: ['text', 'kind', 'priority', 'source_span'],
      },
    },
  },
  required: ['title', 'seniority', 'location', 'company_from_jd', 'responsibilities', 'requirements'],
} as const;

export const extractPrompt = {
  id: 'extract',
  version: PROMPT_VERSION,
  system: `You extract structured facts from job descriptions for an interview preparation tool.

${UNTRUSTED_NOTICE}

RULES — these are graded, so follow them exactly:

1. EVERY requirement must quote a verbatim substring of the description in "source_span".
   Copy it character for character. Do not paraphrase, tidy, or merge separate bullets.
   A requirement whose span is not found verbatim in the description will be DISCARDED.

2. Extract NOTHING that is not in the text. Inventing a requirement the description does
   not contain is worse than reporting that there were few. A two-line description should
   produce two or three requirements, not ten.

3. priority:
   - "must" for what the posting actually requires (under headings like Requirements,
     Must have, Minimum, What you need, About you, or stated as required in prose).
   - "nice" for anything framed as a bonus (Nice to have, Preferred, Plus, Bonus points,
     Desirable, Would be great).
   A "required" line and a "bonus points for" line are NOT the same thing.

4. kind:
   - "technical" = a tool, language, platform, or measurable technical skill.
   - "behavioural" = mentoring, collaboration, communication, ownership, on-call attitude.
   - "domain" = industry or product knowledge (fintech, healthcare, logistics, compliance).

5. Split compound bullets into separate requirements when they name genuinely different
   skills ("Node.js and deep PostgreSQL experience" is two), but keep one requirement when
   the words describe a single skill ("5+ years with React").

6. seniority and location: copy what the posting says ("senior", "staff", "Remote (EU)").
   If the posting does not state it, return an empty string. NEVER guess from salary,
   benefits or tone.

7. responsibilities: what the person will DO day to day, at most 12 short phrases. These
   are not requirements — do not duplicate them into the requirements array.

Return JSON only.`,
  build(jd: string): string {
    return `Extract the role and its requirements from the job description below.

${asUntrustedBlock(jd, 'untrusted_content')}

Remember: every source_span must appear verbatim in the text above.`;
  },
};

// ---------------------------------------------------------------------------
// S3 — hiring process. `found: false` is a first-class, expected answer.
// ---------------------------------------------------------------------------

export const hiringSchema = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    stages: { type: 'array', items: { type: 'string' } },
    has_take_home: { type: 'boolean' },
    has_system_design: { type: 'boolean' },
    timeline: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['found', 'stages', 'has_take_home', 'has_system_design', 'timeline', 'summary'],
} as const;

export const hiringPrompt = {
  id: 'hiring',
  version: PROMPT_VERSION,
  system: `You identify how a company runs its interview process, from pages fetched from its site.

${UNTRUSTED_NOTICE}

RULES:
- If the pages do not actually describe an interview or hiring process, return
  found: false with empty stages and an empty summary. This is a CORRECT and expected
  answer — most company sites do not publish their process. Do not infer a generic
  process from a jobs listing page.
- Only report stages the text actually names. Never fill in a "typical" process.
- has_take_home / has_system_design: true only if the text says so.
- timeline: only if the text states a duration; otherwise an empty string.

Return JSON only.`,
  build(pages: { url: string; text: string }[]): string {
    const body = pages
      .map((p) => `URL: ${p.url}\n${asUntrustedBlock(p.text, 'untrusted_content')}`)
      .join('\n\n');
    return `Identify the hiring/interview process described in these pages, if any.\n\n${body}`;
  },
};

// ---------------------------------------------------------------------------
// S5 — company brief. Grounded only in fetched text, or honestly empty.
// ---------------------------------------------------------------------------

export const briefSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    what_they_do: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
    grounded: { type: 'boolean' },
  },
  required: ['summary', 'what_they_do', 'sources', 'grounded'],
} as const;

export const briefPrompt = {
  id: 'brief',
  version: PROMPT_VERSION,
  system: `You write a short, factual company brief for someone preparing for an interview.

${UNTRUSTED_NOTICE}

RULES:
- Use ONLY the supplied page text. If it does not say what the company does, set
  grounded: false and leave summary and what_they_do empty. An honest "we could not
  find this" is required; a plausible-sounding invention is a failure.
- "sources" must contain only URLs from the list supplied. Never invent a URL.
- summary: 2-4 sentences a candidate could use in an interview.
- what_they_do: one sentence on the product and who pays for it.
- No marketing language. No adjectives the source text does not support.

Return JSON only.`,
  build(company: string, pages: { url: string; text: string }[]): string {
    const body = pages
      .map((p) => `URL: ${p.url}\n${asUntrustedBlock(p.text, 'untrusted_content')}`)
      .join('\n\n');
    return `Write a brief for "${company}" using only these pages.\n\nAllowed source URLs:\n${pages
      .map((p) => `- ${p.url}`)
      .join('\n')}\n\n${body}`;
  },
};

// ---------------------------------------------------------------------------
// S6 — question generation. ONE CALL PER CATEGORY (PLAN.md §4.2).
// "A requirement like five years of React leads to technical questions while mentoring
//  junior engineers leads to behavioural ones; the two should not come from the same call
//  with the same instructions."
// ---------------------------------------------------------------------------

export const questionsSchema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirement_ids: { type: 'array', items: { type: 'string' } },
          prompt: { type: 'string' },
          answer_outline: { type: 'string' },
          difficulty: { type: 'integer' },
        },
        required: ['requirement_ids', 'prompt', 'answer_outline', 'difficulty'],
      },
    },
  },
  required: ['questions'],
} as const;

const CATEGORY_GUIDE: Record<QuestionCategory, string> = {
  technical: `Ask about concrete technical work: how something is built, why one approach over
another, how a specific failure is diagnosed. Prefer "walk me through" and "how would you"
over trivia. No quizzes with a single right answer.`,
  behavioural: `Ask for a specific past situation, in the shape an interviewer actually uses:
"Tell me about a time...". Target ownership, mentoring, conflict, missed deadlines, on-call.
Never ask a technical how-to here.`,
  'system-design': `Ask the candidate to design or evolve a system relevant to this role, with
explicit constraints (scale, consistency, failure modes, cost). One scenario per question.`,
  'company-fit': `Ask what connects the candidate to THIS company and role — its product,
domain, and stated process. Use the company facts supplied. If no company facts were found,
ask role-motivation questions instead and do not invent company details.`,
};

export const questionsPrompt = {
  id: 'questions',
  version: PROMPT_VERSION,
  system(category: QuestionCategory): string {
    return `You write interview questions in ONE category only: ${category}.

${UNTRUSTED_NOTICE}

CATEGORY BRIEF
${CATEGORY_GUIDE[category]}

RULES:
- Every question MUST list the requirement ids it covers, using ONLY the ids supplied.
  Never invent an id. Never tag a requirement the question does not genuinely test —
  unsupported links are rejected by the application and will not count as coverage.
- Tag at most 2 requirement ids per question. If a question does not clearly test a
  requirement, do not list it.
- Cover the requirements marked (must) first. Every must-have requirement supplied should
  have at least one question.
- difficulty: 1 easy, 2 moderate, 3 hard. Vary it; do not label everything 2.
- answer_outline: 2-4 sentences describing what a strong answer contains. It is a guide for
  the candidate, not a model answer.
- prompt: under 60 words, one question, no preamble.
- Do not repeat a question that already exists (they are listed below if any).

Return JSON only.`;
  },
  build(input: {
    category: QuestionCategory;
    role: string;
    seniority: string;
    requirements: Requirement[];
    hiringFacts: string;
    companyFacts: string;
    existingPrompts: string[];
    count: number;
  }): string {
    const reqs = input.requirements
      .map((r) => `- ${r.id} (${r.priority}, ${r.kind}): ${r.text}`)
      .join('\n');
    const parts = [
      `Role: ${input.role}${input.seniority ? ` (${input.seniority})` : ''}`,
      `Write ${input.count} ${input.category} questions.`,
      `\nRequirements you may reference:\n${reqs}`,
    ];
    if (input.hiringFacts) {
      parts.push(
        `\nWhat this company's published hiring process says (use it — it changes which questions make sense):\n${input.hiringFacts}`,
      );
    }
    if (input.companyFacts) parts.push(`\nCompany facts:\n${input.companyFacts}`);
    if (input.existingPrompts.length) {
      parts.push(`\nAlready asked — do NOT repeat these:\n${input.existingPrompts.map((p) => `- ${p}`).join('\n')}`);
    }
    return parts.join('\n');
  },
};

/** Targeted second pass: close named coverage gaps only (PLAN.md §4.3 S7). */
export const gapPrompt = {
  id: 'questions-gap',
  version: PROMPT_VERSION,
  build(input: { category: QuestionCategory; role: string; requirements: Requirement[]; existingPrompts: string[] }): string {
    const reqs = input.requirements.map((r) => `- ${r.id} (${r.priority}): ${r.text}`).join('\n');
    return `Role: ${input.role}

These requirements currently have NO question against them. Write exactly one ${input.category} question for EACH, tagging only its own id:

${reqs}

Do not repeat any of these existing questions:
${input.existingPrompts.slice(0, 20).map((p) => `- ${p}`).join('\n')}`;
  },
};

// ---------------------------------------------------------------------------
// Flashcards
// ---------------------------------------------------------------------------

export const flashcardsSchema = {
  type: 'object',
  properties: {
    flashcards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
          requirement_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['front', 'back', 'requirement_ids'],
      },
    },
  },
  required: ['flashcards'],
} as const;

export const flashcardsPrompt = {
  id: 'flashcards',
  version: PROMPT_VERSION,
  system: `You write flashcards for interview revision.

${UNTRUSTED_NOTICE}

RULES:
- One atomic fact or idea per card. If the back needs "and", it should be two cards.
- front: a question or cue under 20 words. back: under 60 words.
- Every card lists the requirement ids it revises, using only the ids supplied.
- Cards must be genuinely useful to recall under pressure — definitions, trade-offs,
  key numbers, the shape of a strong story. Not trivia.

Return JSON only.`,
  build(input: { role: string; requirements: Requirement[]; count: number }): string {
    const reqs = input.requirements.map((r) => `- ${r.id} (${r.priority}): ${r.text}`).join('\n');
    return `Role: ${input.role}\n\nWrite ${input.count} flashcards covering these requirements:\n${reqs}`;
  },
};
