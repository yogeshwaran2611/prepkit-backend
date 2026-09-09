import { describe, expect, it } from 'vitest';
import type { Question } from '@prepkit/schema';
import { idAllocator } from './ids.js';
import { applyOrder, markEdited, markManual, mergeOrder, mergeSection, normalizeMeta, scopeMatchesQuestion } from './merge.js';

const gen = (id: string, category: Question['category'] = 'technical', prompt = `prompt ${id}`): Question => ({
  id,
  requirement_ids: ['r1'],
  category,
  prompt,
  answer_outline: 'outline',
  difficulty: 2,
  meta: { origin: 'generated', pinned: false, updated_at: '2026-01-01T00:00:00.000Z' },
});

const fresh = (prompt: string, category: Question['category'] = 'technical'): Question => ({
  id: 'PLACEHOLDER',
  requirement_ids: ['r1'],
  category,
  prompt,
  answer_outline: 'new outline',
  difficulty: 2,
});

describe('normalizeMeta', () => {
  it('never leaves meta undefined — every merge rule reads it', () => {
    const out = normalizeMeta([{ id: 'q1' } as Question], 'generated');
    expect(out[0]!.meta).toMatchObject({ origin: 'generated', pinned: false });
  });

  it('does not overwrite meta that already exists', () => {
    const item = { id: 'q1', meta: { origin: 'manual' as const, pinned: true, updated_at: 'x' } };
    expect(normalizeMeta([item], 'generated')[0]!.meta!.origin).toBe('manual');
  });
});

describe('mergeSection — the eight rules', () => {
  const inScope = scopeMatchesQuestion('questions:technical');

  it('replaces unpinned generated items inside the scope', () => {
    const existing = [gen('q1'), gen('q2')];
    const r = mergeSection(existing, [fresh('new A'), fresh('new B')], inScope, idAllocator('q', ['q1', 'q2']));
    expect(r.replaced.sort()).toEqual(['q1', 'q2']);
    expect(r.items.map((i) => i.prompt)).toEqual(['new A', 'new B']);
  });

  it('keeps a manual item forever', () => {
    const mine = markManual(gen('q1', 'technical', 'my own question'));
    const r = mergeSection([mine, gen('q2')], [fresh('replacement')], inScope, idAllocator('q', ['q1', 'q2']));
    expect(r.items.find((i) => i.id === 'q1')!.prompt).toBe('my own question');
    expect(r.kept).toContain('q1');
  });

  it('keeps an edited item and drops the candidate that would have replaced it', () => {
    const edited = markEdited({ ...gen('q1'), prompt: 'my edited wording' });
    const r = mergeSection([edited], [fresh('model wording')], inScope, idAllocator('q', ['q1']));
    expect(r.items.find((i) => i.id === 'q1')!.prompt).toBe('my edited wording');
    expect(r.items.some((i) => i.prompt === 'my edited wording')).toBe(true);
  });

  it('keeps a pinned generated item', () => {
    const pinned = { ...gen('q1'), meta: { origin: 'generated' as const, pinned: true, updated_at: 'x' } };
    const r = mergeSection([pinned], [fresh('replacement')], inScope, idAllocator('q', ['q1']));
    expect(r.kept).toContain('q1');
    expect(r.items.find((i) => i.id === 'q1')).toBeDefined();
  });

  it('leaves items OUTSIDE the scope byte-identical', () => {
    const behavioural = gen('q3', 'behavioural', 'tell me about a time');
    const r = mergeSection([gen('q1'), behavioural], [fresh('new technical')], inScope, idAllocator('q', ['q1', 'q3']));
    expect(r.items.find((i) => i.id === 'q3')).toEqual(behavioural);
  });

  it('never reuses an id that is still present', () => {
    const mine = markManual(gen('q1'));
    const r = mergeSection([mine], [fresh('a'), fresh('b')], inScope, idAllocator('q', ['q1']));
    const ids = r.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toEqual(['q1', 'q1', 'q1']);
  });
});

describe('mergeOrder — user ordering is state (rule 6)', () => {
  it('keeps the relative position of protected items', () => {
    const items = [markManual(gen('q1')), gen('q2'), markEdited(gen('q3'))];
    const order = ['q3', 'q1', 'q2'];
    const r = mergeSection(items, [fresh('new')], scopeMatchesQuestion('questions:technical'), idAllocator('q', ['q1', 'q2', 'q3']));
    const newOrder = mergeOrder(order, ['q1', 'q2', 'q3'], r);
    // q3 and q1 keep their hand-arranged order; the replacement takes q2's slot.
    expect(newOrder.indexOf('q3')).toBeLessThan(newOrder.indexOf('q1'));
    expect(newOrder).toHaveLength(3);
  });

  it('appends genuinely new items rather than reshuffling', () => {
    const items = [markManual(gen('q1'))];
    const r = mergeSection(items, [fresh('a'), fresh('b')], scopeMatchesQuestion('questions:technical'), idAllocator('q', ['q1']));
    const newOrder = mergeOrder(['q1'], ['q1'], r);
    expect(newOrder[0]).toBe('q1');
    expect(newOrder).toHaveLength(3);
  });

  it('applyOrder round-trips and never loses an item', () => {
    const items = [gen('q1'), gen('q2'), gen('q3')];
    expect(applyOrder(items, ['q3', 'q1']).map((i) => i.id)).toEqual(['q3', 'q1', 'q2']);
    expect(applyOrder(items, undefined)).toEqual(items);
    expect(applyOrder(items, ['nope'])).toHaveLength(3);
  });
});

describe('THE HEADLINE CASE — regenerate technical, everything else survives byte-identical', () => {
  it('preserves an edit, a manual question, a pin, the user order, and other categories', () => {
    const edited = markEdited({ ...gen('q1'), prompt: 'MY EDITED WORDING' });
    const manual = markManual({ ...gen('q2'), prompt: 'MY OWN QUESTION' });
    const pinned = { ...gen('q3'), meta: { origin: 'generated' as const, pinned: true, updated_at: 'x' } };
    const plain = gen('q4');
    const behavioural = gen('q5', 'behavioural', 'BEHAVIOURAL UNTOUCHED');
    const systemDesign = gen('q6', 'system-design', 'SYSTEM DESIGN UNTOUCHED');
    const existing = [edited, manual, pinned, plain, behavioural, systemDesign];
    const userOrder = ['q3', 'q2', 'q1', 'q4', 'q5', 'q6'];

    const r = mergeSection(
      existing,
      [fresh('regenerated technical 1'), fresh('regenerated technical 2')],
      scopeMatchesQuestion('questions:technical'),
      idAllocator('q', existing.map((e) => e.id)),
    );
    const order = mergeOrder(userOrder, existing.map((e) => e.id), r);
    const final = applyOrder(r.items, order);

    // Everything the user touched is byte-identical.
    expect(final.find((i) => i.id === 'q1')).toEqual(edited);
    expect(final.find((i) => i.id === 'q2')).toEqual(manual);
    expect(final.find((i) => i.id === 'q3')).toEqual(pinned);
    // Other categories are byte-identical.
    expect(final.find((i) => i.id === 'q5')).toEqual(behavioural);
    expect(final.find((i) => i.id === 'q6')).toEqual(systemDesign);
    // Only the unpinned generated technical question was replaced.
    expect(final.find((i) => i.id === 'q4')).toBeUndefined();
    expect(final.some((i) => i.prompt === 'regenerated technical 1')).toBe(true);
    // The hand-arranged order of surviving items is intact.
    expect(order.indexOf('q3')).toBeLessThan(order.indexOf('q2'));
    expect(order.indexOf('q2')).toBeLessThan(order.indexOf('q1'));
  });
});
