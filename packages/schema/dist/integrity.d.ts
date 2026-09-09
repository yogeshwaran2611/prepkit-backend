import type { Kit } from './kit.js';
/** PLAN.md §3.2 — the referential rules the brief states, asserted in code not a prompt. */
export type IntegrityCode = 'UNKNOWN_REQUIREMENT_REF' | 'UNKNOWN_QUESTION_REF' | 'DAY_COUNT_MISMATCH' | 'DAY_SEQUENCE_GAP' | 'DUPLICATE_FIRST_ASSIGNMENT' | 'REPEAT_ON_NEW_DAY' | 'QUESTION_UNSCHEDULED' | 'MUST_WITHOUT_QUESTION' | 'MUST_UNSCHEDULED' | 'MUST_REPORTED_UNCOVERED' | 'DUPLICATE_ID';
export interface IntegrityIssue {
    code: IntegrityCode;
    message: string;
    ids?: string[];
}
export declare function checkKitIntegrity(kit: Kit): IntegrityIssue[];
export type ValidateResult = {
    ok: true;
    kit: Kit;
} | {
    ok: false;
    zodErrors: string[];
    issues: IntegrityIssue[];
};
/** Zod parse + integrity. Used before every DB write and before every CLI emit. */
export declare function validateKit(input: unknown): ValidateResult;
