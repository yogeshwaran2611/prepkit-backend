/** Monotonic per-kit id allocation. Ids are stable within a kit (Appendix A). */
export type IdPrefix = 'r' | 'q' | 'f';

export function nextId(prefix: IdPrefix, existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/** Allocates a run of fresh ids without re-scanning between each one. */
export function idAllocator(prefix: IdPrefix, existing: Iterable<string>): () => string {
  const seen = new Set(existing);
  return () => {
    const id = nextId(prefix, seen);
    seen.add(id);
    return id;
  };
}
