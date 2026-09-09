import { z } from 'zod';
import { Flashcard, Question, QuestionCategory } from './kit.js';

/** PLAN.md §3.4 — every wire type defined once, imported by both api and web. */

export const RegisterBody = z.object({
  email: z.string().email('That does not look like an email address.').max(200),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
});

export const LoginBody = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const CreateKitBody = z.object({
  jd: z.string().min(1, 'Paste the job description.').max(60_000),
  company_url: z.string().min(1, 'Add the company website address.').max(2_000),
  days: z.number().int().min(1, 'At least one day.').max(60, 'Sixty days is the maximum.'),
});

export const BatchKitBody = z.object({
  cases: z
    .array(
      z.object({
        id: z.string().min(1).max(120).optional(),
        jd: z.string().min(1).max(60_000),
        company_url: z.string().min(1).max(2_000),
        days: z.number().int().min(1).max(60),
      }),
    )
    .min(1, 'Add at least one role.')
    .max(10, 'Ten roles at a time is the maximum.'),
});

/** A single-item edit. Only the fields a user may actually change. */
export const PatchItemBody = z.object({
  section: z.enum(['questions', 'flashcards', 'schedule', 'company_brief', 'role']),
  patch: z
    .object({
      prompt: z.string().max(600).optional(),
      answer_outline: z.string().max(2_000).optional(),
      difficulty: z.number().int().min(1).max(3).optional(),
      category: QuestionCategory.optional(),
      front: z.string().max(300).optional(),
      back: z.string().max(800).optional(),
      focus: z.string().max(200).optional(),
      summary: z.string().max(4_000).optional(),
      what_they_do: z.string().max(1_000).optional(),
      pinned: z.boolean().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, 'Nothing to change.'),
});

export const ReorderBody = z.object({
  section: z.enum(['questions', 'flashcards']),
  ids: z.array(z.string()).min(1).max(500),
});

export const AddItemBody = z.object({
  section: z.enum(['questions', 'flashcards']),
  question: Question.omit({ id: true, meta: true }).partial({ answer_outline: true, difficulty: true }).optional(),
  flashcard: Flashcard.omit({ id: true, meta: true }).partial({ back: true, requirement_ids: true }).optional(),
});

export const RegenerateBody = z.object({
  scope: z.string().regex(/^questions:(technical|behavioural|system-design|company-fit)$/, 'Unsupported section.'),
});

export const PracticeBody = z.object({
  cardId: z.string().min(1).max(40),
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export type RegisterBody = z.infer<typeof RegisterBody>;
export type LoginBody = z.infer<typeof LoginBody>;
export type CreateKitBody = z.infer<typeof CreateKitBody>;
export type BatchKitBody = z.infer<typeof BatchKitBody>;
export type PatchItemBody = z.infer<typeof PatchItemBody>;
export type ReorderBody = z.infer<typeof ReorderBody>;
export type AddItemBody = z.infer<typeof AddItemBody>;
export type RegenerateBody = z.infer<typeof RegenerateBody>;
export type PracticeBody = z.infer<typeof PracticeBody>;
