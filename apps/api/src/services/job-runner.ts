import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Db, JobRecord } from '@prepkit/db';
import type { Deps, StepEvent } from '@prepkit/core';
import { validateKit } from '@prepkit/schema';
import {
  PipelineError,
  applyOrder,
  generateKit,
  mergeOrder,
  mergeSection,
  normalizeMeta,
  reconcileSchedule,
  regenerateQuestionsSection,
  scopeMatchesQuestion,
  summarizeCoverage,
  dedupeNotes,
  note,
  idAllocator,
} from '@prepkit/core';
import type { Kit, Question } from '@prepkit/schema';

/**
 * PLAN.md §6.2 — generation takes 60-120s, so the HTTP request must not own it.
 *
 * The JOB DOCUMENT is the source of truth; the SSE stream is only a view of it. That is what
 * makes a mid-run disconnect, a cold start, or an SSE-buffering proxy degrade to "slower
 * progress bar" instead of a spinner that lies forever.
 *
 * ponytail: in-process queue, no Redis. Single free-tier instance, and the JobQueue shape
 * below is the seam — swapping in BullMQ is one adapter, not a rewrite.
 */

export interface JobRunnerOptions {
  db: Db;
  buildDeps: (progress: (e: StepEvent) => void) => Deps;
  concurrency?: number;
  leaseMs?: number;
}

export class JobRunner {
  private readonly emitter = new EventEmitter();
  private readonly queue: (() => Promise<void>)[] = [];
  private active = 0;
  private readonly concurrency: number;
  private readonly leaseMs: number;

  constructor(private readonly opts: JobRunnerOptions) {
    this.concurrency = opts.concurrency ?? 2;
    this.leaseMs = opts.leaseMs ?? 5 * 60 * 1000;
    this.emitter.setMaxListeners(0);
  }

  /** Boot-time reconciliation: anything a restart interrupted is marked failed, not lost. */
  async reclaim(): Promise<number> {
    const stuck = await this.opts.db.jobs.reclaimExpired(new Date().toISOString());
    for (const job of stuck) {
      await this.opts.db.kits.setStatus(job.kitId, 'failed', {
        error: { code: 'INTERNAL', message: 'The server restarted while this kit was generating. Regenerate to continue.' },
      });
      this.emitter.emit(job.id, { type: 'failed', error: job.error });
    }
    return stuck.length;
  }

  subscribe(jobId: string, listener: (event: unknown) => void): () => void {
    this.emitter.on(jobId, listener);
    return () => this.emitter.off(jobId, listener);
  }

  /** Full generation. Returns immediately; the caller responds 202. */
  async enqueueGenerate(input: { kitId: string; userId: string; jd: string; companyUrl: string; days: number }): Promise<JobRecord> {
    const job = await this.opts.db.jobs.create({
      id: randomUUID(),
      kitId: input.kitId,
      userId: input.userId,
      type: 'generate',
      scope: null,
      status: 'queued',
      steps: [],
      error: null,
      leaseUntil: null,
    });

    this.push(async () => {
      await this.begin(job.id, input.kitId);
      try {
        const result = await generateKit(
          { jd: input.jd, companyUrl: input.companyUrl, days: input.days },
          this.opts.buildDeps((e) => this.onStep(job.id, e)),
        );
        await this.opts.db.kits.setStatus(input.kitId, 'ready', {
          kit: result.kit,
          stepLog: result.stepLog,
          promptVersion: result.promptVersion,
          error: null,
        });
        await this.opts.db.jobs.update(job.id, { status: 'ok', leaseUntil: null });
        this.emitter.emit(job.id, { type: 'done', kitId: input.kitId });
      } catch (e) {
        await this.fail(job.id, input.kitId, e);
      }
    });

    return job;
  }

  /**
   * Regeneration of one section. The merge rules in §5 are applied here, so no route can
   * skip them: manual/edited/pinned items survive, other categories are untouched, the
   * user's ordering is preserved, and the schedule is reconciled rather than rebuilt.
   */
  async enqueueRegenerate(input: {
    kitId: string;
    userId: string;
    scope: string;
  }): Promise<JobRecord> {
    const job = await this.opts.db.jobs.create({
      id: randomUUID(),
      kitId: input.kitId,
      userId: input.userId,
      type: 'regenerate',
      scope: input.scope,
      status: 'queued',
      steps: [],
      error: null,
      leaseUntil: null,
    });

    this.push(async () => {
      await this.begin(job.id, input.kitId, 'running');
      try {
        const record = await this.opts.db.kits.findOwned(input.userId, input.kitId);
        if (!record?.kit) throw new PipelineError('That kit no longer exists.', 'INVALID_INPUT');

        const category = input.scope.startsWith('questions:')
          ? (input.scope.slice('questions:'.length) as Question['category'])
          : null;
        if (!category) throw new PipelineError(`Cannot regenerate scope "${input.scope}".`, 'INVALID_INPUT');

        const deps = this.opts.buildDeps((e) => this.onStep(job.id, e));
        // cacheSalt = jobId, so the cache can never hand back the identical section (§4.5).
        const { questions: fresh, notes } = await regenerateQuestionsSection(
          { kit: record.kit, category, cacheSalt: job.id },
          deps,
        );

        const merged = mergeQuestionSection(record.kit, category, fresh);
        const withNotes = { ...merged, notes: dedupeNotes([...(merged.notes ?? []), ...notes]) };

        const validated = validateKit(withNotes);
        if (!validated.ok) {
          throw new PipelineError(
            `The regenerated section did not validate: ${[...validated.zodErrors, ...validated.issues.map((i) => i.message)]
              .slice(0, 2)
              .join('; ')}`,
            'INTERNAL',
          );
        }

        const saved = await this.opts.db.kits.replaceKit(input.userId, input.kitId, record.version, validated.kit);
        if (!saved) {
          // Someone else wrote while we were generating: the client must rebase (§5).
          throw new PipelineError('This kit changed while the section was regenerating. Reload and try again.', 'INTERNAL');
        }
        await this.opts.db.kits.setStatus(input.kitId, 'ready');
        await this.opts.db.jobs.update(job.id, { status: 'ok', leaseUntil: null });
        this.emitter.emit(job.id, {
          type: 'done',
          kitId: input.kitId,
          // Powers the "6 replaced, 3 of your edits kept" message.
          summary: summarizeMerge(record.kit, validated.kit, category),
        });
      } catch (e) {
        await this.fail(job.id, input.kitId, e, 'ready');
      }
    });

    return job;
  }

  // --- internals ------------------------------------------------------------

  private push(task: () => Promise<void>): void {
    this.queue.push(task);
    this.drain();
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift()!;
      this.active++;
      void task()
        .catch((e) => console.error('job task crashed', e))
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }

  private async begin(jobId: string, kitId: string, kitStatus: 'running' | 'ready' = 'running'): Promise<void> {
    await this.opts.db.jobs.update(jobId, {
      status: 'running',
      leaseUntil: new Date(Date.now() + this.leaseMs).toISOString(),
    });
    if (kitStatus === 'running') await this.opts.db.kits.setStatus(kitId, 'running');
    this.emitter.emit(jobId, { type: 'status', status: 'running' });
  }

  private onStep(jobId: string, e: StepEvent): void {
    // Persist first (the document is the truth), then notify (the stream is a view).
    void this.opts.db.jobs.appendStep(jobId, e).catch(() => {});
    void this.opts.db.jobs
      .update(jobId, { leaseUntil: new Date(Date.now() + this.leaseMs).toISOString() })
      .catch(() => {});
    this.emitter.emit(jobId, { type: 'step', step: e });
  }

  private async fail(jobId: string, kitId: string, e: unknown, kitStatus: 'failed' | 'ready' = 'failed'): Promise<void> {
    const code = e instanceof PipelineError ? e.code : 'INTERNAL';
    const message = e instanceof Error ? e.message : String(e);
    await this.opts.db.jobs.update(jobId, { status: 'failed', error: { code, message }, leaseUntil: null });
    await this.opts.db.kits.setStatus(kitId, kitStatus, { error: { code, message } });
    this.emitter.emit(jobId, { type: 'failed', error: { code, message } });
  }
}

/**
 * The §5 merge, extracted so it is testable without a queue, a DB, or a model.
 */
export function mergeQuestionSection(kit: Kit, category: Question['category'], fresh: Question[]): Kit {
  const existing = normalizeMeta(kit.questions, 'generated');
  const inScope = scopeMatchesQuestion(`questions:${category}`);
  const result = mergeSection(existing, normalizeMeta(fresh, 'generated'), inScope, idAllocator('q', existing.map((q) => q.id)));

  const order = mergeOrder(kit.order?.questions, existing.map((q) => q.id), result);
  const questions = applyOrder(result.items, order);

  // The schedule is DERIVED but not disposable: reconcile, never rebuild (§5.1).
  const reconciled = reconcileSchedule(kit.schedule.days, questions, kit.role.requirements);

  return {
    ...kit,
    questions,
    schedule: { ...kit.schedule, days: reconciled.days },
    coverage: summarizeCoverage(kit.role.requirements, questions, kit.coverage.passes),
    order: { ...kit.order, questions: order, ...(kit.order?.flashcards ? { flashcards: kit.order.flashcards } : {}) },
    notes: reconciled.reconciled ? dedupeNotes([...(kit.notes ?? []), note('SCHEDULE_RECONCILED')]) : kit.notes,
  };
}

/** "6 questions replaced, 3 of your edits kept" — makes the state model visible. */
export function summarizeMerge(before: Kit, after: Kit, category: Question['category']) {
  const beforeIds = new Set(before.questions.filter((q) => q.category === category).map((q) => q.id));
  const afterInCategory = after.questions.filter((q) => q.category === category);
  const kept = afterInCategory.filter((q) => beforeIds.has(q.id));
  return {
    replaced: [...beforeIds].filter((id) => !afterInCategory.some((q) => q.id === id)).length,
    added: afterInCategory.filter((q) => !beforeIds.has(q.id)).length,
    keptProtected: kept.filter((q) => q.meta && (q.meta.origin !== 'generated' || q.meta.pinned)).length,
    untouchedOtherCategories: after.questions.filter((q) => q.category !== category).length,
  };
}
