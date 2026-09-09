import { z } from 'zod';
/**
 * Appendix A, exact field names. Every field the brief names is present and required.
 * Our extensions are `.optional()`/`.default()`ed so a kit stays valid under a strict
 * reading of Appendix A. See PLAN.md §3.1.
 */
export declare const RequirementKind: z.ZodEnum<["technical", "behavioural", "domain"]>;
export declare const RequirementPriority: z.ZodEnum<["must", "nice"]>;
export declare const QuestionCategory: z.ZodEnum<["technical", "behavioural", "system-design", "company-fit"]>;
/** Every merge rule in §5 branches on this, so it is never absent in memory or in the DB. */
export declare const ItemMeta: z.ZodObject<{
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
}>;
/** The anti-invention proof: offsets index into the ORIGINAL jd string (§4.3 S1). */
export declare const Provenance: z.ZodObject<{
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
}>;
export declare const NoteCode: z.ZodEnum<["THIN_JD", "NO_HIRING_PAGE", "NO_PUBLIC_DISCUSSION", "COMPANY_UNREACHABLE", "ROBOTS_BLOCKED", "THIN_PAGE", "BUDGET_EXHAUSTED", "FALLBACK_QUESTION_USED", "LINKS_REJECTED", "SCHEDULE_OVERLOADED", "SCHEDULE_RECONCILED", "PROVIDER_FAILOVER"]>;
export declare const KitNote: z.ZodObject<{
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
}>;
export declare const Requirement: z.ZodObject<{
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
}>;
export declare const Question: z.ZodObject<{
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
}>;
export declare const Flashcard: z.ZodObject<{
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
}>;
export declare const ScheduleDay: z.ZodObject<{
    day: z.ZodNumber;
    focus: z.ZodString;
    question_ids: z.ZodArray<z.ZodString, "many">;
    minutes: z.ZodNumber;
    /** 'review' days may repeat ids first assigned earlier (§4.3 S8, days=60). */
    kind: z.ZodDefault<z.ZodEnum<["new", "review"]>>;
    /** A user-edited day is frozen: reconciliation may only remove dead ids (§5.1). */
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
}>;
export declare const Kit: z.ZodObject<{
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
            /** 'review' days may repeat ids first assigned earlier (§4.3 S8, days=60). */
            kind: z.ZodDefault<z.ZodEnum<["new", "review"]>>;
            /** A user-edited day is frozen: reconciliation may only remove dead ids (§5.1). */
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
    /** User ordering is state and survives regeneration (§5 rule 6). */
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
}>;
export type ItemMeta = z.infer<typeof ItemMeta>;
export type Provenance = z.infer<typeof Provenance>;
export type NoteCode = z.infer<typeof NoteCode>;
export type KitNote = z.infer<typeof KitNote>;
export type Requirement = z.infer<typeof Requirement>;
export type Question = z.infer<typeof Question>;
export type Flashcard = z.infer<typeof Flashcard>;
export type ScheduleDay = z.infer<typeof ScheduleDay>;
export type Kit = z.infer<typeof Kit>;
export type QuestionCategory = z.infer<typeof QuestionCategory>;
export type RequirementPriority = z.infer<typeof RequirementPriority>;
