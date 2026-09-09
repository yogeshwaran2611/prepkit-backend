import { z } from 'zod';
/** Appendix B — frozen. PLAN.md §3.3 */
export declare const ErrorCode: z.ZodEnum<["COMPANY_UNREACHABLE", "LLM_UNAVAILABLE", "INVALID_INPUT", "EXTRACTION_EMPTY", "CASE_TIMEOUT", "INTERNAL"]>;
export declare const BatchCase: z.ZodObject<{
    id: z.ZodString;
    jd: z.ZodString;
    company_url: z.ZodString;
    days: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    company_url: string;
    days: number;
    jd: string;
}, {
    id: string;
    company_url: string;
    days: number;
    jd: string;
}>;
export declare const BatchResult: z.ZodObject<{
    id: z.ZodString;
    status: z.ZodEnum<["ok", "failed"]>;
    kit: z.ZodNullable<z.ZodObject<{
        source: z.ZodObject<{
            company: z.ZodString;
            company_url: z.ZodString;
            role: z.ZodString;
            location: z.ZodString;
            jd_chars: z.ZodNumber;
            researched_at: z.ZodString;
            pages_used: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            company: string;
            company_url: string;
            role: string;
            location: string;
            jd_chars: number;
            researched_at: string;
            pages_used: string[];
        }, {
            company: string;
            company_url: string;
            role: string;
            location: string;
            jd_chars: number;
            researched_at: string;
            pages_used: string[];
        }>;
        company_brief: z.ZodObject<{
            summary: z.ZodString;
            what_they_do: z.ZodString;
            sources: z.ZodArray<z.ZodString, "many">;
            hiring_process: z.ZodOptional<z.ZodString>;
            confidence: z.ZodOptional<z.ZodEnum<["none", "low", "medium", "high"]>>;
        }, "strip", z.ZodTypeAny, {
            summary: string;
            what_they_do: string;
            sources: string[];
            hiring_process?: string | undefined;
            confidence?: "none" | "low" | "medium" | "high" | undefined;
        }, {
            summary: string;
            what_they_do: string;
            sources: string[];
            hiring_process?: string | undefined;
            confidence?: "none" | "low" | "medium" | "high" | undefined;
        }>;
        role: z.ZodObject<{
            title: z.ZodString;
            seniority: z.ZodString;
            responsibilities: z.ZodArray<z.ZodString, "many">;
            requirements: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                text: z.ZodString;
                kind: z.ZodEnum<["technical", "behavioural", "domain"]>;
                priority: z.ZodEnum<["must", "nice"]>;
                provenance: z.ZodOptional<z.ZodObject<{
                    source_span: z.ZodString;
                    start: z.ZodNumber;
                    end: z.ZodNumber;
                    heading: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    source_span: string;
                    start: number;
                    end: number;
                    heading?: string | undefined;
                }, {
                    source_span: string;
                    start: number;
                    end: number;
                    heading?: string | undefined;
                }>>;
            }, "strip", z.ZodTypeAny, {
                id: string;
                text: string;
                kind: "technical" | "behavioural" | "domain";
                priority: "must" | "nice";
                provenance?: {
                    source_span: string;
                    start: number;
                    end: number;
                    heading?: string | undefined;
                } | undefined;
            }, {
                id: string;
                text: string;
                kind: "technical" | "behavioural" | "domain";
                priority: "must" | "nice";
                provenance?: {
                    source_span: string;
                    start: number;
                    end: number;
                    heading?: string | undefined;
                } | undefined;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            title: string;
            seniority: string;
            responsibilities: string[];
            requirements: {
                id: string;
                text: string;
                kind: "technical" | "behavioural" | "domain";
                priority: "must" | "nice";
                provenance?: {
                    source_span: string;
                    start: number;
                    end: number;
                    heading?: string | undefined;
                } | undefined;
            }[];
        }, {
            title: string;
            seniority: string;
            responsibilities: string[];
            requirements: {
                id: string;
                text: string;
                kind: "technical" | "behavioural" | "domain";
                priority: "must" | "nice";
                provenance?: {
                    source_span: string;
                    start: number;
                    end: number;
                    heading?: string | undefined;
                } | undefined;
            }[];
        }>;
        questions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            requirement_ids: z.ZodArray<z.ZodString, "many">;
            category: z.ZodEnum<["technical", "behavioural", "system-design", "company-fit"]>;
            prompt: z.ZodString;
            answer_outline: z.ZodString;
            difficulty: z.ZodNumber;
            meta: z.ZodOptional<z.ZodObject<{
                origin: z.ZodEnum<["generated", "edited", "manual"]>;
                pinned: z.ZodDefault<z.ZodBoolean>;
                updated_at: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                origin: "generated" | "edited" | "manual";
                pinned: boolean;
                updated_at: string;
            }, {
                origin: "generated" | "edited" | "manual";
                updated_at: string;
                pinned?: boolean | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            id: string;
            requirement_ids: string[];
            category: "technical" | "behavioural" | "system-design" | "company-fit";
            prompt: string;
            answer_outline: string;
            difficulty: number;
            meta?: {
                origin: "generated" | "edited" | "manual";
                pinned: boolean;
                updated_at: string;
            } | undefined;
        }, {
            id: string;
            requirement_ids: string[];
            category: "technical" | "behavioural" | "system-design" | "company-fit";
            prompt: string;
            answer_outline: string;
            difficulty: number;
            meta?: {
                origin: "generated" | "edited" | "manual";
                updated_at: string;
                pinned?: boolean | undefined;
            } | undefined;
        }>, "many">;
        flashcards: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            front: z.ZodString;
            back: z.ZodString;
            requirement_ids: z.ZodArray<z.ZodString, "many">;
            meta: z.ZodOptional<z.ZodObject<{
                origin: z.ZodEnum<["generated", "edited", "manual"]>;
                pinned: z.ZodDefault<z.ZodBoolean>;
                updated_at: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                origin: "generated" | "edited" | "manual";
                pinned: boolean;
                updated_at: string;
            }, {
                origin: "generated" | "edited" | "manual";
                updated_at: string;
                pinned?: boolean | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            id: string;
            requirement_ids: string[];
            front: string;
            back: string;
            meta?: {
                origin: "generated" | "edited" | "manual";
                pinned: boolean;
                updated_at: string;
            } | undefined;
        }, {
            id: string;
            requirement_ids: string[];
            front: string;
            back: string;
            meta?: {
                origin: "generated" | "edited" | "manual";
                updated_at: string;
                pinned?: boolean | undefined;
            } | undefined;
        }>, "many">;
        schedule: z.ZodObject<{
            days_available: z.ZodNumber;
            days: z.ZodArray<z.ZodObject<{
                day: z.ZodNumber;
                focus: z.ZodString;
                question_ids: z.ZodArray<z.ZodString, "many">;
                minutes: z.ZodNumber;
                kind: z.ZodDefault<z.ZodEnum<["new", "review"]>>;
                meta: z.ZodOptional<z.ZodObject<{
                    origin: z.ZodEnum<["generated", "edited", "manual"]>;
                    pinned: z.ZodDefault<z.ZodBoolean>;
                    updated_at: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                }, {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                }>>;
            }, "strip", z.ZodTypeAny, {
                kind: "new" | "review";
                day: number;
                focus: string;
                question_ids: string[];
                minutes: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }, {
                day: number;
                focus: string;
                question_ids: string[];
                minutes: number;
                kind?: "new" | "review" | undefined;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            days_available: number;
            days: {
                kind: "new" | "review";
                day: number;
                focus: string;
                question_ids: string[];
                minutes: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }[];
        }, {
            days_available: number;
            days: {
                day: number;
                focus: string;
                question_ids: string[];
                minutes: number;
                kind?: "new" | "review" | undefined;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }[];
        }>;
        coverage: z.ZodObject<{
            uncovered_requirement_ids: z.ZodArray<z.ZodString, "many">;
            passes: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            uncovered_requirement_ids: string[];
            passes: number;
        }, {
            uncovered_requirement_ids: string[];
            passes: number;
        }>;
        notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
            code: z.ZodEnum<["THIN_JD", "NO_HIRING_PAGE", "NO_PUBLIC_DISCUSSION", "COMPANY_UNREACHABLE", "ROBOTS_BLOCKED", "THIN_PAGE", "BUDGET_EXHAUSTED", "FALLBACK_QUESTION_USED", "LINKS_REJECTED", "SCHEDULE_OVERLOADED", "SCHEDULE_RECONCILED", "PROVIDER_FAILOVER"]>;
            message: z.ZodString;
            detail: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, "strip", z.ZodTypeAny, {
            code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
            message: string;
            detail?: Record<string, unknown> | undefined;
        }, {
            code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
            message: string;
            detail?: Record<string, unknown> | undefined;
        }>, "many">>;
        order: z.ZodOptional<z.ZodObject<{
            questions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            flashcards: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            responsibilities: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            responsibilities?: string[] | undefined;
            questions?: string[] | undefined;
            flashcards?: string[] | undefined;
        }, {
            responsibilities?: string[] | undefined;
            questions?: string[] | undefined;
            flashcards?: string[] | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        source: {
            company: string;
            company_url: string;
            role: string;
            location: string;
            jd_chars: number;
            researched_at: string;
            pages_used: string[];
        };
        role: {
            title: string;
            seniority: string;
            responsibilities: string[];
            requirements: {
                id: string;
                text: string;
                kind: "technical" | "behavioural" | "domain";
                priority: "must" | "nice";
                provenance?: {
                    source_span: string;
                    start: number;
                    end: number;
                    heading?: string | undefined;
                } | undefined;
            }[];
        };
        company_brief: {
            summary: string;
            what_they_do: string;
            sources: string[];
            hiring_process?: string | undefined;
            confidence?: "none" | "low" | "medium" | "high" | undefined;
        };
        questions: {
            id: string;
            requirement_ids: string[];
            category: "technical" | "behavioural" | "system-design" | "company-fit";
            prompt: string;
            answer_outline: string;
            difficulty: number;
            meta?: {
                origin: "generated" | "edited" | "manual";
                pinned: boolean;
                updated_at: string;
            } | undefined;
        }[];
        flashcards: {
            id: string;
            requirement_ids: string[];
            front: string;
            back: string;
            meta?: {
                origin: "generated" | "edited" | "manual";
                pinned: boolean;
                updated_at: string;
            } | undefined;
        }[];
        schedule: {
            days_available: number;
            days: {
                kind: "new" | "review";
                day: number;
                focus: string;
                question_ids: string[];
                minutes: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }[];
        };
        coverage: {
            uncovered_requirement_ids: string[];
            passes: number;
        };
        notes?: {
            code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
            message: string;
            detail?: Record<string, unknown> | undefined;
        }[] | undefined;
        order?: {
            responsibilities?: string[] | undefined;
            questions?: string[] | undefined;
            flashcards?: string[] | undefined;
        } | undefined;
    }, {
        source: {
            company: string;
            company_url: string;
            role: string;
            location: string;
            jd_chars: number;
            researched_at: string;
            pages_used: string[];
        };
        role: {
            title: string;
            seniority: string;
            responsibilities: string[];
            requirements: {
                id: string;
                text: string;
                kind: "technical" | "behavioural" | "domain";
                priority: "must" | "nice";
                provenance?: {
                    source_span: string;
                    start: number;
                    end: number;
                    heading?: string | undefined;
                } | undefined;
            }[];
        };
        company_brief: {
            summary: string;
            what_they_do: string;
            sources: string[];
            hiring_process?: string | undefined;
            confidence?: "none" | "low" | "medium" | "high" | undefined;
        };
        questions: {
            id: string;
            requirement_ids: string[];
            category: "technical" | "behavioural" | "system-design" | "company-fit";
            prompt: string;
            answer_outline: string;
            difficulty: number;
            meta?: {
                origin: "generated" | "edited" | "manual";
                updated_at: string;
                pinned?: boolean | undefined;
            } | undefined;
        }[];
        flashcards: {
            id: string;
            requirement_ids: string[];
            front: string;
            back: string;
            meta?: {
                origin: "generated" | "edited" | "manual";
                updated_at: string;
                pinned?: boolean | undefined;
            } | undefined;
        }[];
        schedule: {
            days_available: number;
            days: {
                day: number;
                focus: string;
                question_ids: string[];
                minutes: number;
                kind?: "new" | "review" | undefined;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }[];
        };
        coverage: {
            uncovered_requirement_ids: string[];
            passes: number;
        };
        notes?: {
            code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
            message: string;
            detail?: Record<string, unknown> | undefined;
        }[] | undefined;
        order?: {
            responsibilities?: string[] | undefined;
            questions?: string[] | undefined;
            flashcards?: string[] | undefined;
        } | undefined;
    }>>;
    error: z.ZodNullable<z.ZodObject<{
        code: z.ZodEnum<["COMPANY_UNREACHABLE", "LLM_UNAVAILABLE", "INVALID_INPUT", "EXTRACTION_EMPTY", "CASE_TIMEOUT", "INTERNAL"]>;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: "COMPANY_UNREACHABLE" | "LLM_UNAVAILABLE" | "INVALID_INPUT" | "EXTRACTION_EMPTY" | "CASE_TIMEOUT" | "INTERNAL";
        message: string;
    }, {
        code: "COMPANY_UNREACHABLE" | "LLM_UNAVAILABLE" | "INVALID_INPUT" | "EXTRACTION_EMPTY" | "CASE_TIMEOUT" | "INTERNAL";
        message: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    status: "ok" | "failed";
    id: string;
    kit: {
        source: {
            company: string;
            company_url: string;
            role: string;
            location: string;
            jd_chars: number;
            researched_at: string;
            pages_used: string[];
        };
        role: {
            title: string;
            seniority: string;
            responsibilities: string[];
            requirements: {
                id: string;
                text: string;
                kind: "technical" | "behavioural" | "domain";
                priority: "must" | "nice";
                provenance?: {
                    source_span: string;
                    start: number;
                    end: number;
                    heading?: string | undefined;
                } | undefined;
            }[];
        };
        company_brief: {
            summary: string;
            what_they_do: string;
            sources: string[];
            hiring_process?: string | undefined;
            confidence?: "none" | "low" | "medium" | "high" | undefined;
        };
        questions: {
            id: string;
            requirement_ids: string[];
            category: "technical" | "behavioural" | "system-design" | "company-fit";
            prompt: string;
            answer_outline: string;
            difficulty: number;
            meta?: {
                origin: "generated" | "edited" | "manual";
                pinned: boolean;
                updated_at: string;
            } | undefined;
        }[];
        flashcards: {
            id: string;
            requirement_ids: string[];
            front: string;
            back: string;
            meta?: {
                origin: "generated" | "edited" | "manual";
                pinned: boolean;
                updated_at: string;
            } | undefined;
        }[];
        schedule: {
            days_available: number;
            days: {
                kind: "new" | "review";
                day: number;
                focus: string;
                question_ids: string[];
                minutes: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }[];
        };
        coverage: {
            uncovered_requirement_ids: string[];
            passes: number;
        };
        notes?: {
            code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
            message: string;
            detail?: Record<string, unknown> | undefined;
        }[] | undefined;
        order?: {
            responsibilities?: string[] | undefined;
            questions?: string[] | undefined;
            flashcards?: string[] | undefined;
        } | undefined;
    } | null;
    error: {
        code: "COMPANY_UNREACHABLE" | "LLM_UNAVAILABLE" | "INVALID_INPUT" | "EXTRACTION_EMPTY" | "CASE_TIMEOUT" | "INTERNAL";
        message: string;
    } | null;
}, {
    status: "ok" | "failed";
    id: string;
    kit: {
        source: {
            company: string;
            company_url: string;
            role: string;
            location: string;
            jd_chars: number;
            researched_at: string;
            pages_used: string[];
        };
        role: {
            title: string;
            seniority: string;
            responsibilities: string[];
            requirements: {
                id: string;
                text: string;
                kind: "technical" | "behavioural" | "domain";
                priority: "must" | "nice";
                provenance?: {
                    source_span: string;
                    start: number;
                    end: number;
                    heading?: string | undefined;
                } | undefined;
            }[];
        };
        company_brief: {
            summary: string;
            what_they_do: string;
            sources: string[];
            hiring_process?: string | undefined;
            confidence?: "none" | "low" | "medium" | "high" | undefined;
        };
        questions: {
            id: string;
            requirement_ids: string[];
            category: "technical" | "behavioural" | "system-design" | "company-fit";
            prompt: string;
            answer_outline: string;
            difficulty: number;
            meta?: {
                origin: "generated" | "edited" | "manual";
                updated_at: string;
                pinned?: boolean | undefined;
            } | undefined;
        }[];
        flashcards: {
            id: string;
            requirement_ids: string[];
            front: string;
            back: string;
            meta?: {
                origin: "generated" | "edited" | "manual";
                updated_at: string;
                pinned?: boolean | undefined;
            } | undefined;
        }[];
        schedule: {
            days_available: number;
            days: {
                day: number;
                focus: string;
                question_ids: string[];
                minutes: number;
                kind?: "new" | "review" | undefined;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }[];
        };
        coverage: {
            uncovered_requirement_ids: string[];
            passes: number;
        };
        notes?: {
            code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
            message: string;
            detail?: Record<string, unknown> | undefined;
        }[] | undefined;
        order?: {
            responsibilities?: string[] | undefined;
            questions?: string[] | undefined;
            flashcards?: string[] | undefined;
        } | undefined;
    } | null;
    error: {
        code: "COMPANY_UNREACHABLE" | "LLM_UNAVAILABLE" | "INVALID_INPUT" | "EXTRACTION_EMPTY" | "CASE_TIMEOUT" | "INTERNAL";
        message: string;
    } | null;
}>;
export declare const BatchOutput: z.ZodObject<{
    version: z.ZodLiteral<"1.0">;
    generated_at: z.ZodString;
    kits: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        status: z.ZodEnum<["ok", "failed"]>;
        kit: z.ZodNullable<z.ZodObject<{
            source: z.ZodObject<{
                company: z.ZodString;
                company_url: z.ZodString;
                role: z.ZodString;
                location: z.ZodString;
                jd_chars: z.ZodNumber;
                researched_at: z.ZodString;
                pages_used: z.ZodArray<z.ZodString, "many">;
            }, "strip", z.ZodTypeAny, {
                company: string;
                company_url: string;
                role: string;
                location: string;
                jd_chars: number;
                researched_at: string;
                pages_used: string[];
            }, {
                company: string;
                company_url: string;
                role: string;
                location: string;
                jd_chars: number;
                researched_at: string;
                pages_used: string[];
            }>;
            company_brief: z.ZodObject<{
                summary: z.ZodString;
                what_they_do: z.ZodString;
                sources: z.ZodArray<z.ZodString, "many">;
                hiring_process: z.ZodOptional<z.ZodString>;
                confidence: z.ZodOptional<z.ZodEnum<["none", "low", "medium", "high"]>>;
            }, "strip", z.ZodTypeAny, {
                summary: string;
                what_they_do: string;
                sources: string[];
                hiring_process?: string | undefined;
                confidence?: "none" | "low" | "medium" | "high" | undefined;
            }, {
                summary: string;
                what_they_do: string;
                sources: string[];
                hiring_process?: string | undefined;
                confidence?: "none" | "low" | "medium" | "high" | undefined;
            }>;
            role: z.ZodObject<{
                title: z.ZodString;
                seniority: z.ZodString;
                responsibilities: z.ZodArray<z.ZodString, "many">;
                requirements: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    text: z.ZodString;
                    kind: z.ZodEnum<["technical", "behavioural", "domain"]>;
                    priority: z.ZodEnum<["must", "nice"]>;
                    provenance: z.ZodOptional<z.ZodObject<{
                        source_span: z.ZodString;
                        start: z.ZodNumber;
                        end: z.ZodNumber;
                        heading: z.ZodOptional<z.ZodString>;
                    }, "strip", z.ZodTypeAny, {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    }, {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    }>>;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    text: string;
                    kind: "technical" | "behavioural" | "domain";
                    priority: "must" | "nice";
                    provenance?: {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    } | undefined;
                }, {
                    id: string;
                    text: string;
                    kind: "technical" | "behavioural" | "domain";
                    priority: "must" | "nice";
                    provenance?: {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    } | undefined;
                }>, "many">;
            }, "strip", z.ZodTypeAny, {
                title: string;
                seniority: string;
                responsibilities: string[];
                requirements: {
                    id: string;
                    text: string;
                    kind: "technical" | "behavioural" | "domain";
                    priority: "must" | "nice";
                    provenance?: {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    } | undefined;
                }[];
            }, {
                title: string;
                seniority: string;
                responsibilities: string[];
                requirements: {
                    id: string;
                    text: string;
                    kind: "technical" | "behavioural" | "domain";
                    priority: "must" | "nice";
                    provenance?: {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    } | undefined;
                }[];
            }>;
            questions: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                requirement_ids: z.ZodArray<z.ZodString, "many">;
                category: z.ZodEnum<["technical", "behavioural", "system-design", "company-fit"]>;
                prompt: z.ZodString;
                answer_outline: z.ZodString;
                difficulty: z.ZodNumber;
                meta: z.ZodOptional<z.ZodObject<{
                    origin: z.ZodEnum<["generated", "edited", "manual"]>;
                    pinned: z.ZodDefault<z.ZodBoolean>;
                    updated_at: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                }, {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                }>>;
            }, "strip", z.ZodTypeAny, {
                id: string;
                requirement_ids: string[];
                category: "technical" | "behavioural" | "system-design" | "company-fit";
                prompt: string;
                answer_outline: string;
                difficulty: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }, {
                id: string;
                requirement_ids: string[];
                category: "technical" | "behavioural" | "system-design" | "company-fit";
                prompt: string;
                answer_outline: string;
                difficulty: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }>, "many">;
            flashcards: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                front: z.ZodString;
                back: z.ZodString;
                requirement_ids: z.ZodArray<z.ZodString, "many">;
                meta: z.ZodOptional<z.ZodObject<{
                    origin: z.ZodEnum<["generated", "edited", "manual"]>;
                    pinned: z.ZodDefault<z.ZodBoolean>;
                    updated_at: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                }, {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                }>>;
            }, "strip", z.ZodTypeAny, {
                id: string;
                requirement_ids: string[];
                front: string;
                back: string;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }, {
                id: string;
                requirement_ids: string[];
                front: string;
                back: string;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }>, "many">;
            schedule: z.ZodObject<{
                days_available: z.ZodNumber;
                days: z.ZodArray<z.ZodObject<{
                    day: z.ZodNumber;
                    focus: z.ZodString;
                    question_ids: z.ZodArray<z.ZodString, "many">;
                    minutes: z.ZodNumber;
                    kind: z.ZodDefault<z.ZodEnum<["new", "review"]>>;
                    meta: z.ZodOptional<z.ZodObject<{
                        origin: z.ZodEnum<["generated", "edited", "manual"]>;
                        pinned: z.ZodDefault<z.ZodBoolean>;
                        updated_at: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        origin: "generated" | "edited" | "manual";
                        pinned: boolean;
                        updated_at: string;
                    }, {
                        origin: "generated" | "edited" | "manual";
                        updated_at: string;
                        pinned?: boolean | undefined;
                    }>>;
                }, "strip", z.ZodTypeAny, {
                    kind: "new" | "review";
                    day: number;
                    focus: string;
                    question_ids: string[];
                    minutes: number;
                    meta?: {
                        origin: "generated" | "edited" | "manual";
                        pinned: boolean;
                        updated_at: string;
                    } | undefined;
                }, {
                    day: number;
                    focus: string;
                    question_ids: string[];
                    minutes: number;
                    kind?: "new" | "review" | undefined;
                    meta?: {
                        origin: "generated" | "edited" | "manual";
                        updated_at: string;
                        pinned?: boolean | undefined;
                    } | undefined;
                }>, "many">;
            }, "strip", z.ZodTypeAny, {
                days_available: number;
                days: {
                    kind: "new" | "review";
                    day: number;
                    focus: string;
                    question_ids: string[];
                    minutes: number;
                    meta?: {
                        origin: "generated" | "edited" | "manual";
                        pinned: boolean;
                        updated_at: string;
                    } | undefined;
                }[];
            }, {
                days_available: number;
                days: {
                    day: number;
                    focus: string;
                    question_ids: string[];
                    minutes: number;
                    kind?: "new" | "review" | undefined;
                    meta?: {
                        origin: "generated" | "edited" | "manual";
                        updated_at: string;
                        pinned?: boolean | undefined;
                    } | undefined;
                }[];
            }>;
            coverage: z.ZodObject<{
                uncovered_requirement_ids: z.ZodArray<z.ZodString, "many">;
                passes: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                uncovered_requirement_ids: string[];
                passes: number;
            }, {
                uncovered_requirement_ids: string[];
                passes: number;
            }>;
            notes: z.ZodOptional<z.ZodArray<z.ZodObject<{
                code: z.ZodEnum<["THIN_JD", "NO_HIRING_PAGE", "NO_PUBLIC_DISCUSSION", "COMPANY_UNREACHABLE", "ROBOTS_BLOCKED", "THIN_PAGE", "BUDGET_EXHAUSTED", "FALLBACK_QUESTION_USED", "LINKS_REJECTED", "SCHEDULE_OVERLOADED", "SCHEDULE_RECONCILED", "PROVIDER_FAILOVER"]>;
                message: z.ZodString;
                detail: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            }, "strip", z.ZodTypeAny, {
                code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
                message: string;
                detail?: Record<string, unknown> | undefined;
            }, {
                code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
                message: string;
                detail?: Record<string, unknown> | undefined;
            }>, "many">>;
            order: z.ZodOptional<z.ZodObject<{
                questions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                flashcards: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                responsibilities: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            }, "strip", z.ZodTypeAny, {
                responsibilities?: string[] | undefined;
                questions?: string[] | undefined;
                flashcards?: string[] | undefined;
            }, {
                responsibilities?: string[] | undefined;
                questions?: string[] | undefined;
                flashcards?: string[] | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            source: {
                company: string;
                company_url: string;
                role: string;
                location: string;
                jd_chars: number;
                researched_at: string;
                pages_used: string[];
            };
            role: {
                title: string;
                seniority: string;
                responsibilities: string[];
                requirements: {
                    id: string;
                    text: string;
                    kind: "technical" | "behavioural" | "domain";
                    priority: "must" | "nice";
                    provenance?: {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    } | undefined;
                }[];
            };
            company_brief: {
                summary: string;
                what_they_do: string;
                sources: string[];
                hiring_process?: string | undefined;
                confidence?: "none" | "low" | "medium" | "high" | undefined;
            };
            questions: {
                id: string;
                requirement_ids: string[];
                category: "technical" | "behavioural" | "system-design" | "company-fit";
                prompt: string;
                answer_outline: string;
                difficulty: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }[];
            flashcards: {
                id: string;
                requirement_ids: string[];
                front: string;
                back: string;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }[];
            schedule: {
                days_available: number;
                days: {
                    kind: "new" | "review";
                    day: number;
                    focus: string;
                    question_ids: string[];
                    minutes: number;
                    meta?: {
                        origin: "generated" | "edited" | "manual";
                        pinned: boolean;
                        updated_at: string;
                    } | undefined;
                }[];
            };
            coverage: {
                uncovered_requirement_ids: string[];
                passes: number;
            };
            notes?: {
                code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
                message: string;
                detail?: Record<string, unknown> | undefined;
            }[] | undefined;
            order?: {
                responsibilities?: string[] | undefined;
                questions?: string[] | undefined;
                flashcards?: string[] | undefined;
            } | undefined;
        }, {
            source: {
                company: string;
                company_url: string;
                role: string;
                location: string;
                jd_chars: number;
                researched_at: string;
                pages_used: string[];
            };
            role: {
                title: string;
                seniority: string;
                responsibilities: string[];
                requirements: {
                    id: string;
                    text: string;
                    kind: "technical" | "behavioural" | "domain";
                    priority: "must" | "nice";
                    provenance?: {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    } | undefined;
                }[];
            };
            company_brief: {
                summary: string;
                what_they_do: string;
                sources: string[];
                hiring_process?: string | undefined;
                confidence?: "none" | "low" | "medium" | "high" | undefined;
            };
            questions: {
                id: string;
                requirement_ids: string[];
                category: "technical" | "behavioural" | "system-design" | "company-fit";
                prompt: string;
                answer_outline: string;
                difficulty: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }[];
            flashcards: {
                id: string;
                requirement_ids: string[];
                front: string;
                back: string;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }[];
            schedule: {
                days_available: number;
                days: {
                    day: number;
                    focus: string;
                    question_ids: string[];
                    minutes: number;
                    kind?: "new" | "review" | undefined;
                    meta?: {
                        origin: "generated" | "edited" | "manual";
                        updated_at: string;
                        pinned?: boolean | undefined;
                    } | undefined;
                }[];
            };
            coverage: {
                uncovered_requirement_ids: string[];
                passes: number;
            };
            notes?: {
                code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
                message: string;
                detail?: Record<string, unknown> | undefined;
            }[] | undefined;
            order?: {
                responsibilities?: string[] | undefined;
                questions?: string[] | undefined;
                flashcards?: string[] | undefined;
            } | undefined;
        }>>;
        error: z.ZodNullable<z.ZodObject<{
            code: z.ZodEnum<["COMPANY_UNREACHABLE", "LLM_UNAVAILABLE", "INVALID_INPUT", "EXTRACTION_EMPTY", "CASE_TIMEOUT", "INTERNAL"]>;
            message: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            code: "COMPANY_UNREACHABLE" | "LLM_UNAVAILABLE" | "INVALID_INPUT" | "EXTRACTION_EMPTY" | "CASE_TIMEOUT" | "INTERNAL";
            message: string;
        }, {
            code: "COMPANY_UNREACHABLE" | "LLM_UNAVAILABLE" | "INVALID_INPUT" | "EXTRACTION_EMPTY" | "CASE_TIMEOUT" | "INTERNAL";
            message: string;
        }>>;
    }, "strip", z.ZodTypeAny, {
        status: "ok" | "failed";
        id: string;
        kit: {
            source: {
                company: string;
                company_url: string;
                role: string;
                location: string;
                jd_chars: number;
                researched_at: string;
                pages_used: string[];
            };
            role: {
                title: string;
                seniority: string;
                responsibilities: string[];
                requirements: {
                    id: string;
                    text: string;
                    kind: "technical" | "behavioural" | "domain";
                    priority: "must" | "nice";
                    provenance?: {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    } | undefined;
                }[];
            };
            company_brief: {
                summary: string;
                what_they_do: string;
                sources: string[];
                hiring_process?: string | undefined;
                confidence?: "none" | "low" | "medium" | "high" | undefined;
            };
            questions: {
                id: string;
                requirement_ids: string[];
                category: "technical" | "behavioural" | "system-design" | "company-fit";
                prompt: string;
                answer_outline: string;
                difficulty: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }[];
            flashcards: {
                id: string;
                requirement_ids: string[];
                front: string;
                back: string;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }[];
            schedule: {
                days_available: number;
                days: {
                    kind: "new" | "review";
                    day: number;
                    focus: string;
                    question_ids: string[];
                    minutes: number;
                    meta?: {
                        origin: "generated" | "edited" | "manual";
                        pinned: boolean;
                        updated_at: string;
                    } | undefined;
                }[];
            };
            coverage: {
                uncovered_requirement_ids: string[];
                passes: number;
            };
            notes?: {
                code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
                message: string;
                detail?: Record<string, unknown> | undefined;
            }[] | undefined;
            order?: {
                responsibilities?: string[] | undefined;
                questions?: string[] | undefined;
                flashcards?: string[] | undefined;
            } | undefined;
        } | null;
        error: {
            code: "COMPANY_UNREACHABLE" | "LLM_UNAVAILABLE" | "INVALID_INPUT" | "EXTRACTION_EMPTY" | "CASE_TIMEOUT" | "INTERNAL";
            message: string;
        } | null;
    }, {
        status: "ok" | "failed";
        id: string;
        kit: {
            source: {
                company: string;
                company_url: string;
                role: string;
                location: string;
                jd_chars: number;
                researched_at: string;
                pages_used: string[];
            };
            role: {
                title: string;
                seniority: string;
                responsibilities: string[];
                requirements: {
                    id: string;
                    text: string;
                    kind: "technical" | "behavioural" | "domain";
                    priority: "must" | "nice";
                    provenance?: {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    } | undefined;
                }[];
            };
            company_brief: {
                summary: string;
                what_they_do: string;
                sources: string[];
                hiring_process?: string | undefined;
                confidence?: "none" | "low" | "medium" | "high" | undefined;
            };
            questions: {
                id: string;
                requirement_ids: string[];
                category: "technical" | "behavioural" | "system-design" | "company-fit";
                prompt: string;
                answer_outline: string;
                difficulty: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }[];
            flashcards: {
                id: string;
                requirement_ids: string[];
                front: string;
                back: string;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }[];
            schedule: {
                days_available: number;
                days: {
                    day: number;
                    focus: string;
                    question_ids: string[];
                    minutes: number;
                    kind?: "new" | "review" | undefined;
                    meta?: {
                        origin: "generated" | "edited" | "manual";
                        updated_at: string;
                        pinned?: boolean | undefined;
                    } | undefined;
                }[];
            };
            coverage: {
                uncovered_requirement_ids: string[];
                passes: number;
            };
            notes?: {
                code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
                message: string;
                detail?: Record<string, unknown> | undefined;
            }[] | undefined;
            order?: {
                responsibilities?: string[] | undefined;
                questions?: string[] | undefined;
                flashcards?: string[] | undefined;
            } | undefined;
        } | null;
        error: {
            code: "COMPANY_UNREACHABLE" | "LLM_UNAVAILABLE" | "INVALID_INPUT" | "EXTRACTION_EMPTY" | "CASE_TIMEOUT" | "INTERNAL";
            message: string;
        } | null;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    version: "1.0";
    generated_at: string;
    kits: {
        status: "ok" | "failed";
        id: string;
        kit: {
            source: {
                company: string;
                company_url: string;
                role: string;
                location: string;
                jd_chars: number;
                researched_at: string;
                pages_used: string[];
            };
            role: {
                title: string;
                seniority: string;
                responsibilities: string[];
                requirements: {
                    id: string;
                    text: string;
                    kind: "technical" | "behavioural" | "domain";
                    priority: "must" | "nice";
                    provenance?: {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    } | undefined;
                }[];
            };
            company_brief: {
                summary: string;
                what_they_do: string;
                sources: string[];
                hiring_process?: string | undefined;
                confidence?: "none" | "low" | "medium" | "high" | undefined;
            };
            questions: {
                id: string;
                requirement_ids: string[];
                category: "technical" | "behavioural" | "system-design" | "company-fit";
                prompt: string;
                answer_outline: string;
                difficulty: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }[];
            flashcards: {
                id: string;
                requirement_ids: string[];
                front: string;
                back: string;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    pinned: boolean;
                    updated_at: string;
                } | undefined;
            }[];
            schedule: {
                days_available: number;
                days: {
                    kind: "new" | "review";
                    day: number;
                    focus: string;
                    question_ids: string[];
                    minutes: number;
                    meta?: {
                        origin: "generated" | "edited" | "manual";
                        pinned: boolean;
                        updated_at: string;
                    } | undefined;
                }[];
            };
            coverage: {
                uncovered_requirement_ids: string[];
                passes: number;
            };
            notes?: {
                code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
                message: string;
                detail?: Record<string, unknown> | undefined;
            }[] | undefined;
            order?: {
                responsibilities?: string[] | undefined;
                questions?: string[] | undefined;
                flashcards?: string[] | undefined;
            } | undefined;
        } | null;
        error: {
            code: "COMPANY_UNREACHABLE" | "LLM_UNAVAILABLE" | "INVALID_INPUT" | "EXTRACTION_EMPTY" | "CASE_TIMEOUT" | "INTERNAL";
            message: string;
        } | null;
    }[];
}, {
    version: "1.0";
    generated_at: string;
    kits: {
        status: "ok" | "failed";
        id: string;
        kit: {
            source: {
                company: string;
                company_url: string;
                role: string;
                location: string;
                jd_chars: number;
                researched_at: string;
                pages_used: string[];
            };
            role: {
                title: string;
                seniority: string;
                responsibilities: string[];
                requirements: {
                    id: string;
                    text: string;
                    kind: "technical" | "behavioural" | "domain";
                    priority: "must" | "nice";
                    provenance?: {
                        source_span: string;
                        start: number;
                        end: number;
                        heading?: string | undefined;
                    } | undefined;
                }[];
            };
            company_brief: {
                summary: string;
                what_they_do: string;
                sources: string[];
                hiring_process?: string | undefined;
                confidence?: "none" | "low" | "medium" | "high" | undefined;
            };
            questions: {
                id: string;
                requirement_ids: string[];
                category: "technical" | "behavioural" | "system-design" | "company-fit";
                prompt: string;
                answer_outline: string;
                difficulty: number;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }[];
            flashcards: {
                id: string;
                requirement_ids: string[];
                front: string;
                back: string;
                meta?: {
                    origin: "generated" | "edited" | "manual";
                    updated_at: string;
                    pinned?: boolean | undefined;
                } | undefined;
            }[];
            schedule: {
                days_available: number;
                days: {
                    day: number;
                    focus: string;
                    question_ids: string[];
                    minutes: number;
                    kind?: "new" | "review" | undefined;
                    meta?: {
                        origin: "generated" | "edited" | "manual";
                        updated_at: string;
                        pinned?: boolean | undefined;
                    } | undefined;
                }[];
            };
            coverage: {
                uncovered_requirement_ids: string[];
                passes: number;
            };
            notes?: {
                code: "THIN_JD" | "NO_HIRING_PAGE" | "NO_PUBLIC_DISCUSSION" | "COMPANY_UNREACHABLE" | "ROBOTS_BLOCKED" | "THIN_PAGE" | "BUDGET_EXHAUSTED" | "FALLBACK_QUESTION_USED" | "LINKS_REJECTED" | "SCHEDULE_OVERLOADED" | "SCHEDULE_RECONCILED" | "PROVIDER_FAILOVER";
                message: string;
                detail?: Record<string, unknown> | undefined;
            }[] | undefined;
            order?: {
                responsibilities?: string[] | undefined;
                questions?: string[] | undefined;
                flashcards?: string[] | undefined;
            } | undefined;
        } | null;
        error: {
            code: "COMPANY_UNREACHABLE" | "LLM_UNAVAILABLE" | "INVALID_INPUT" | "EXTRACTION_EMPTY" | "CASE_TIMEOUT" | "INTERNAL";
            message: string;
        } | null;
    }[];
}>;
export type ErrorCode = z.infer<typeof ErrorCode>;
export type BatchCase = z.infer<typeof BatchCase>;
export type BatchResult = z.infer<typeof BatchResult>;
export type BatchOutput = z.infer<typeof BatchOutput>;
