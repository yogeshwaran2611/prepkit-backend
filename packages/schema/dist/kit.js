import { z } from 'zod';
/**
 * Appendix A, exact field names. Every field the brief names is present and required.
 * Our extensions are `.optional()`/`.default()`ed so a kit stays valid under a strict
 * reading of Appendix A. See PLAN.md §3.1.
 */
export const RequirementKind = z.enum(['technical', 'behavioural', 'domain']);
export const RequirementPriority = z.enum(['must', 'nice']);
export const QuestionCategory = z.enum([
    'technical',
    'behavioural',
    'system-design',
    'company-fit',
]);
/** Every merge rule in §5 branches on this, so it is never absent in memory or in the DB. */
export const ItemMeta = z.object({
    origin: z.enum(['generated', 'edited', 'manual']),
    pinned: z.boolean().default(false),
    updated_at: z.string().datetime(),
});
/** The anti-invention proof: offsets index into the ORIGINAL jd string (§4.3 S1). */
export const Provenance = z.object({
    source_span: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    heading: z.string().optional(),
});
export const NoteCode = z.enum([
    'THIN_JD',
    'NO_HIRING_PAGE',
    'NO_PUBLIC_DISCUSSION',
    'COMPANY_UNREACHABLE',
    'ROBOTS_BLOCKED',
    'THIN_PAGE',
    'BUDGET_EXHAUSTED',
    'FALLBACK_QUESTION_USED',
    'LINKS_REJECTED',
    'SCHEDULE_OVERLOADED',
    'SCHEDULE_RECONCILED',
    'PROVIDER_FAILOVER',
]);
export const KitNote = z.object({
    code: NoteCode,
    message: z.string().min(1),
    detail: z.record(z.string(), z.unknown()).optional(),
});
export const Requirement = z.object({
    id: z.string().regex(/^r\d+$/),
    text: z.string().min(1).max(400),
    kind: RequirementKind,
    priority: RequirementPriority,
    provenance: Provenance.optional(),
});
export const Question = z.object({
    id: z.string().regex(/^q\d+$/),
    requirement_ids: z.array(z.string()).min(1).max(3),
    category: QuestionCategory,
    prompt: z.string().min(1).max(600),
    answer_outline: z.string().max(2000),
    difficulty: z.number().int().min(1).max(3),
    meta: ItemMeta.optional(),
});
export const Flashcard = z.object({
    id: z.string().regex(/^f\d+$/),
    front: z.string().min(1).max(300),
    back: z.string().max(800),
    requirement_ids: z.array(z.string()).max(3),
    meta: ItemMeta.optional(),
});
export const ScheduleDay = z.object({
    day: z.number().int().positive(),
    focus: z.string(),
    question_ids: z.array(z.string()),
    minutes: z.number().int().nonnegative(),
    /** 'review' days may repeat ids first assigned earlier (§4.3 S8, days=60). */
    kind: z.enum(['new', 'review']).default('new'),
    /** A user-edited day is frozen: reconciliation may only remove dead ids (§5.1). */
    meta: ItemMeta.optional(),
});
export const Kit = z.object({
    source: z.object({
        company: z.string().min(1),
        company_url: z.string(),
        role: z.string(),
        location: z.string(),
        jd_chars: z.number().int().nonnegative(),
        researched_at: z.string(),
        pages_used: z.array(z.string()),
    }),
    company_brief: z.object({
        summary: z.string(),
        what_they_do: z.string(),
        sources: z.array(z.string()),
        hiring_process: z.string().optional(),
        confidence: z.enum(['none', 'low', 'medium', 'high']).optional(),
    }),
    role: z.object({
        title: z.string(),
        seniority: z.string(),
        responsibilities: z.array(z.string()),
        requirements: z.array(Requirement),
    }),
    questions: z.array(Question),
    flashcards: z.array(Flashcard),
    schedule: z.object({
        days_available: z.number().int().positive(),
        days: z.array(ScheduleDay),
    }),
    coverage: z.object({
        uncovered_requirement_ids: z.array(z.string()),
        passes: z.number().int().nonnegative(),
    }),
    notes: z.array(KitNote).optional(),
    /** User ordering is state and survives regeneration (§5 rule 6). */
    order: z
        .object({
        questions: z.array(z.string()).optional(),
        flashcards: z.array(z.string()).optional(),
        responsibilities: z.array(z.string()).optional(),
    })
        .optional(),
});
