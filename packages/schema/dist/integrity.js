import { Kit as KitSchema } from './kit.js';
export function checkKitIntegrity(kit) {
    const issues = [];
    const push = (code, message, ids) => issues.push(ids ? { code, message, ids } : { code, message });
    const reqIds = new Set(kit.role.requirements.map((r) => r.id));
    const qIds = new Set(kit.questions.map((q) => q.id));
    // 5. all ids unique (prefix shape is enforced by the Zod regexes)
    const allIds = [
        ...kit.role.requirements.map((r) => r.id),
        ...kit.questions.map((q) => q.id),
        ...kit.flashcards.map((f) => f.id),
    ];
    const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
    if (dupes.length)
        push('DUPLICATE_ID', 'ids must be unique within a kit', unique(dupes));
    // 1. every question/flashcard requirement ref exists
    for (const q of kit.questions) {
        const bad = q.requirement_ids.filter((id) => !reqIds.has(id));
        if (bad.length)
            push('UNKNOWN_REQUIREMENT_REF', `question ${q.id} references unknown requirement`, bad);
    }
    for (const f of kit.flashcards) {
        const bad = f.requirement_ids.filter((id) => !reqIds.has(id));
        if (bad.length)
            push('UNKNOWN_REQUIREMENT_REF', `flashcard ${f.id} references unknown requirement`, bad);
    }
    // 2. every scheduled question exists
    for (const d of kit.schedule.days) {
        const bad = d.question_ids.filter((id) => !qIds.has(id));
        if (bad.length)
            push('UNKNOWN_QUESTION_REF', `day ${d.day} references unknown question`, bad);
    }
    // 3a. day count is exactly what was requested, and days run 1..n with no gaps
    const days = [...kit.schedule.days].sort((a, b) => a.day - b.day);
    if (days.length !== kit.schedule.days_available)
        push('DAY_COUNT_MISMATCH', `schedule has ${days.length} days, days_available is ${kit.schedule.days_available}`);
    days.forEach((d, i) => {
        if (d.day !== i + 1)
            push('DAY_SEQUENCE_GAP', `expected day ${i + 1}, found day ${d.day}`);
    });
    // 3b. exactly one FIRST assignment per question; repeats only on kind:'review' days.
    // (Naive global uniqueness is the wrong rule — it fails days=60. See PLAN.md §4.3 S8.)
    const firstSeenOn = new Map();
    for (const d of days) {
        for (const id of d.question_ids) {
            const seen = firstSeenOn.get(id);
            if (seen === undefined) {
                firstSeenOn.set(id, d.day);
            }
            else if ((d.kind ?? 'new') === 'new') {
                push('REPEAT_ON_NEW_DAY', `question ${id} repeats on new-day ${d.day} (first assigned day ${seen}); repeats are legal only on review days`, [id]);
            }
        }
        // a repeat within a single day is always wrong, review or not
        const withinDay = d.question_ids.filter((id, i) => d.question_ids.indexOf(id) !== i);
        if (withinDay.length)
            push('DUPLICATE_FIRST_ASSIGNMENT', `day ${d.day} lists a question twice`, unique(withinDay));
    }
    // 3c. every question is allocated somewhere — "allocates all of it"
    const unscheduled = [...qIds].filter((id) => !firstSeenOn.has(id));
    if (unscheduled.length)
        push('QUESTION_UNSCHEDULED', 'every question must appear in the schedule', unscheduled);
    // 4. every must-have has a question AND lands on some day
    const musts = kit.role.requirements.filter((r) => r.priority === 'must');
    const coveredReqIds = new Set(kit.questions.flatMap((q) => q.requirement_ids));
    for (const r of musts) {
        if (!coveredReqIds.has(r.id))
            push('MUST_WITHOUT_QUESTION', `must-have ${r.id} has no question`, [r.id]);
        else {
            const scheduled = kit.questions.some((q) => q.requirement_ids.includes(r.id) && firstSeenOn.has(q.id));
            if (!scheduled)
                push('MUST_UNSCHEDULED', `must-have ${r.id} appears in no schedule day`, [r.id]);
        }
        // S7 synthesises a fallback question for any uncovered must, so a must listed here is a bug
        if (kit.coverage.uncovered_requirement_ids.includes(r.id))
            push('MUST_REPORTED_UNCOVERED', `must-have ${r.id} is reported uncovered; the fallback question path should have closed it`, [r.id]);
    }
    return issues;
}
/** Zod parse + integrity. Used before every DB write and before every CLI emit. */
export function validateKit(input) {
    const parsed = KitSchema.safeParse(input);
    if (!parsed.success)
        return {
            ok: false,
            zodErrors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
            issues: [],
        };
    const issues = checkKitIntegrity(parsed.data);
    return issues.length ? { ok: false, zodErrors: [], issues } : { ok: true, kit: parsed.data };
}
const unique = (xs) => [...new Set(xs)];
