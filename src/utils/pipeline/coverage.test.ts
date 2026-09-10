import { describe, expect, it } from 'vitest';
import type { Question, Requirement } from '../../schemas/index.js';
import { acceptLink, fallbackQuestion, findCoverageGaps, pruneLinks, summarizeCoverage } from './coverage.js';

const r = (id: string, text: string, priority: 'must' | 'nice' = 'must'): Requirement => ({
  id,
  text,
  kind: 'technical',
  priority,
});

const q = (id: string, reqIds: string[], prompt: string, outline = ''): Question => ({
  id,
  requirement_ids: reqIds,
  category: 'technical',
  prompt,
  answer_outline: outline,
  difficulty: 2,
});

describe('acceptLink — the link-quality gate', () => {
  it('accepts a question that shares a salient technical term', () => {
    expect(
      acceptLink(
        { prompt: 'How would you tune a slow PostgreSQL query?', answer_outline: 'EXPLAIN, indexes' },
        r('r1', 'Deep PostgreSQL experience: query tuning, migrations'),
      ),
    ).toBe(true);
  });

  it('accepts on lexical overlap without an exact salient match', () => {
    expect(
      acceptLink(
        { prompt: 'Describe how you mentored a junior engineer through a hard review.', answer_outline: '' },
        r('r2', 'You have mentored junior engineers'),
      ),
    ).toBe(true);
  });

  it('REJECTS an unrelated question — this is what stops fake coverage', () => {
    expect(
      acceptLink(
        { prompt: 'What is your favourite programming book?', answer_outline: 'anything' },
        r('r3', 'Deep PostgreSQL experience: query tuning, migrations'),
      ),
    ).toBe(false);
  });

  it('rejects an empty question', () => {
    expect(acceptLink({ prompt: '', answer_outline: '' }, r('r1', 'Kubernetes and Terraform'))).toBe(false);
  });
});

describe('pruneLinks', () => {
  const reqs = [
    r('r1', 'Deep PostgreSQL experience: query tuning'),
    r('r2', 'You have mentored junior engineers'),
    r('r3', 'Experience with Kubernetes and Terraform'),
    r('r4', 'Strong Kafka event streaming background'),
  ];

  it('drops shotgun tags so they cannot close gaps', () => {
    // One honest link (r1) plus three tagged-on ids the text does not support.
    const shotgun = q('q1', ['r1', 'r2', 'r3', 'r4'], 'How do you tune a slow PostgreSQL query?', 'EXPLAIN');
    const out = pruneLinks([shotgun], reqs);
    expect(out.questions[0]!.requirement_ids).toEqual(['r1']);
    expect(out.rejected).toBeGreaterThan(0);
    // r2..r4 remain gaps: the bad links did NOT cover them.
    const gaps = findCoverageGaps(reqs, out.questions).map((g) => g.requirement_id);
    expect(gaps).toEqual(['r2', 'r3', 'r4']);
  });

  it('caps links at three even when all are plausible', () => {
    const many = q('q2', ['r1', 'r2', 'r3', 'r4'], 'Discuss PostgreSQL, mentoring, Kubernetes and Kafka together', 'all four');
    const out = pruneLinks([many], reqs);
    expect(out.questions[0]!.requirement_ids.length).toBeLessThanOrEqual(3);
  });

  it('discards a question left with no supported link', () => {
    const junk = q('q3', ['r1'], 'What is your favourite colour?', '');
    const out = pruneLinks([junk], reqs);
    expect(out.questions).toHaveLength(0);
    expect(out.discarded).toEqual(['q3']);
  });

  it('never second-guesses a question the user wrote or edited', () => {
    const mine: Question = { ...q('q4', ['r3'], 'My own question', ''), meta: { origin: 'manual', pinned: false, updated_at: 'now' } };
    const out = pruneLinks([mine], reqs);
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0]!.requirement_ids).toEqual(['r3']);
  });
});

describe('findCoverageGaps', () => {
  const reqs = [r('r1', 'Node.js services'), r('r2', 'Kubernetes', 'nice'), r('r3', 'PostgreSQL tuning')];

  it('reports requirements with no question against them', () => {
    const gaps = findCoverageGaps(reqs, [q('q1', ['r1'], 'Node.js question')]);
    expect(gaps.map((g) => g.requirement_id)).toEqual(['r3', 'r2']);
  });

  it('sorts must-haves before nice-to-haves', () => {
    const gaps = findCoverageGaps(reqs, []);
    expect(gaps[0]!.priority).toBe('must');
    expect(gaps.at(-1)!.priority).toBe('nice');
  });

  it('returns nothing when everything is covered', () => {
    const covered = reqs.map((x, i) => q(`q${i}`, [x.id], x.text));
    expect(findCoverageGaps(reqs, covered)).toEqual([]);
  });

  it('counts passes honestly', () => {
    expect(summarizeCoverage(reqs, [], 3).passes).toBe(3);
    expect(summarizeCoverage(reqs, [], 3).uncovered_requirement_ids).toHaveLength(3);
  });
});

describe('fallbackQuestion — a kit must never ship with an uncovered must-have', () => {
  it('builds a question that references the requirement and passes the link gate', () => {
    const req = r('r7', 'Deep PostgreSQL experience: query tuning, migrations');
    const fq = fallbackQuestion(req, 'q99');
    expect(fq.requirement_ids).toEqual(['r7']);
    expect(findCoverageGaps([req], [fq])).toEqual([]);
    expect(acceptLink(fq, req)).toBe(true);
  });

  it('produces a behavioural prompt for a behavioural requirement', () => {
    const fq = fallbackQuestion({ id: 'r8', text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must' }, 'q98');
    expect(fq.category).toBe('behavioural');
    expect(fq.prompt).toMatch(/Tell me about a time/);
  });
});
