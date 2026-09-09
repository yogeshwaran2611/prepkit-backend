import type { Flashcard, ItemMeta, Question } from '@prepkit/schema';

/**
 * PLAN.md §5 — the hardest state problem in the assessment (15 pts).
 * "Regenerating one section must not discard edits the user has made elsewhere, and a
 *  question the user wrote or edited by hand must survive a regeneration of its category."
 */

export type SectionScope =
  | 'company_brief'
  | 'flashcards'
  | 'schedule'
  | `questions:${string}`;

export interface Identified {
  id: string;
  // `| undefined` is required under exactOptionalPropertyTypes: Kit items declare
  // `meta?: ItemMeta | undefined`, which is NOT assignable to a bare `meta?: ItemMeta`.
  meta?: ItemMeta | undefined;
}

export interface MergeResult<T> {
  items: T[];
  kept: string[];
  replaced: string[];
  added: string[];
  /** Regenerated candidates dropped because a protected item held their place. */
  droppedCandidates: number;
}

export const now = (): string => new Date().toISOString();

/** Model output has no meta; every merge rule reads it, so it is never absent (§5 ingest). */
export function normalizeMeta<T extends { meta?: ItemMeta | undefined }>(
  items: T[],
  origin: ItemMeta['origin'],
  at: string = now(),
): T[] {
  return items.map((it) =>
    it.meta ? it : ({ ...it, meta: { origin, pinned: false, updated_at: at } } as T),
  );
}

const isProtected = (m: ItemMeta | undefined): boolean =>
  !!m && (m.origin === 'manual' || m.origin === 'edited' || m.pinned);

/**
 * Merge one section. `existing` is everything currently in the section (in or out of scope);
 * `regenerated` is fresh model output for the scope; `inScope` decides membership.
 */
export function mergeSection<T extends Identified>(
  existing: T[],
  regenerated: T[],
  inScope: (item: T) => boolean,
  allocId: () => string,
): MergeResult<T> {
  const kept: string[] = [];
  const replaced: string[] = [];
  const added: string[] = [];

  // Rules 1, 2, 4: protected items and everything outside the scope survive untouched.
  const survivors = existing.filter((it) => !inScope(it) || isProtected(it.meta));
  for (const s of survivors) kept.push(s.id);

  // Rule 3: unprotected generated items inside the scope are replaced.
  for (const it of existing) if (inScope(it) && !isProtected(it.meta)) replaced.push(it.id);

  // Rule 5: fresh ids never collide with anything still present.
  const fresh = regenerated.map((it) => {
    const id = allocId();
    added.push(id);
    return { ...it, id, meta: it.meta ?? { origin: 'generated', pinned: false, updated_at: now() } } as T;
  });

  return {
    items: [...survivors, ...fresh],
    kept,
    replaced,
    added,
    droppedCandidates: 0,
  };
}

/**
 * Rule 6 — user ordering is state and survives regeneration. Kept items hold their relative
 * positions, replaced items yield their slot to what replaced them, new items append.
 */
export function mergeOrder<T extends Identified>(
  existingOrder: string[] | undefined,
  existingIds: string[],
  result: MergeResult<T>,
): string[] {
  const base = existingOrder?.length ? existingOrder.filter((id) => existingIds.includes(id)) : existingIds;
  const keptSet = new Set(result.kept);
  const replacedSet = new Set(result.replaced);
  const incoming = [...result.added];

  const out: string[] = [];
  for (const id of base) {
    if (keptSet.has(id)) out.push(id);
    else if (replacedSet.has(id)) {
      const next = incoming.shift();
      if (next) out.push(next);
    }
  }
  out.push(...incoming);
  // Anything the order array never knew about (e.g. first run) lands at the end, once.
  for (const id of result.items.map((i) => i.id)) if (!out.includes(id)) out.push(id);
  return out;
}

/** Applies a stored order to an array; unknown ids keep their array position at the end. */
export function applyOrder<T extends { id: string }>(items: T[], order: string[] | undefined): T[] {
  if (!order?.length) return items;
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: T[] = [];
  for (const id of order) {
    const it = byId.get(id);
    if (it) {
      out.push(it);
      byId.delete(id);
    }
  }
  return [...out, ...byId.values()];
}

/** Marks an item as user-edited so no future regeneration may replace it (§5 rule 2). */
export function markEdited<T extends { meta?: ItemMeta | undefined }>(item: T): T {
  return {
    ...item,
    meta: { origin: 'edited', pinned: item.meta?.pinned ?? false, updated_at: now() },
  };
}

export function markManual<T extends { meta?: ItemMeta | undefined }>(item: T): T {
  return { ...item, meta: { origin: 'manual', pinned: item.meta?.pinned ?? false, updated_at: now() } };
}

export const scopeMatchesQuestion = (scope: SectionScope) => (q: Question): boolean => {
  if (scope === 'flashcards' || scope === 'company_brief' || scope === 'schedule') return false;
  const category = scope.slice('questions:'.length);
  return category === 'all' || q.category === category;
};

export const scopeMatchesFlashcard = (scope: SectionScope) => (_f: Flashcard): boolean =>
  scope === 'flashcards';
