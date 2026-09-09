/**
 * Gemini's `responseSchema` accepts a RESTRICTED OpenAPI subset: no $ref, no anyOf,
 * limited nesting. So each step gets its own FLAT hand-written schema — never the
 * composite Kit. PLAN.md §7. These are the schemas the probe verifies against the live API.
 */

export const requirementsSchema = {
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
  required: ['title', 'seniority', 'location', 'responsibilities', 'requirements'],
} as const;

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

export const briefSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    what_they_do: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
    found: { type: 'boolean' },
  },
  required: ['summary', 'what_they_do', 'sources', 'found'],
} as const;

export const hiringSchema = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    stages: { type: 'array', items: { type: 'string' } },
    has_take_home: { type: 'boolean' },
    has_system_design: { type: 'boolean' },
    timeline: { type: 'string' },
  },
  required: ['found', 'stages'],
} as const;

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

export const ALL = {
  requirements: requirementsSchema,
  questions: questionsSchema,
  brief: briefSchema,
  hiring: hiringSchema,
  flashcards: flashcardsSchema,
} as const;
