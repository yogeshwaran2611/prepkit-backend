import { z } from 'zod';
import { Kit } from './kit.js';
/** Appendix B — frozen. PLAN.md §3.3 */
export const ErrorCode = z.enum([
    'COMPANY_UNREACHABLE',
    'LLM_UNAVAILABLE',
    'INVALID_INPUT',
    'EXTRACTION_EMPTY',
    'CASE_TIMEOUT',
    'INTERNAL',
]);
export const BatchCase = z.object({
    id: z.string().min(1),
    jd: z.string(),
    company_url: z.string(),
    days: z.number().int().min(1).max(60),
});
export const BatchResult = z.object({
    id: z.string(),
    status: z.enum(['ok', 'failed']),
    kit: Kit.nullable(),
    error: z.object({ code: ErrorCode, message: z.string() }).nullable(),
});
export const BatchOutput = z.object({
    version: z.literal('1.0'),
    generated_at: z.string(),
    kits: z.array(BatchResult),
});
