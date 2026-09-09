import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Db } from '@prepkit/db';
import {
  AddItemBody,
  BatchKitBody,
  CreateKitBody,
  PatchItemBody,
  PracticeBody,
  RegenerateBody,
  ReorderBody,
  type Flashcard,
  type Kit,
  type Question,
  validateKit,
} from '@prepkit/schema';
import {
  applyOrder,
  idAllocator,
  markEdited,
  markManual,
  reconcileSchedule,
  summarizeCoverage,
  weakSpotPlan,
  weakSpots,
} from '@prepkit/core';
import type { Config } from '../config.js';
import { ApiError, asyncRoute } from '../middleware/errors.js';
import { rateLimit, validate } from '../middleware/common.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import type { JobRunner } from '../services/job-runner.js';

export function kitsRouter(config: Config, db: Db, runner: JobRunner): Router {
  const router = Router();
  router.use(requireAuth(config, db));

  /** Generation is the expensive path, so it gets its own limiter. */
  const generateLimit = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.generateMax,
    key: (req) => (req as AuthedRequest).user?.id ?? req.ip ?? 'anon',
  });

  // --- list / read ---------------------------------------------------------

  router.get(
    '/',
    asyncRoute<AuthedRequest>(async (req, res) => {
      const kits = await db.kits.listOwned(req.user.id);
      res.json({
        data: kits.map((k) => ({
          id: k.id,
          status: k.status,
          company: k.kit?.source.company ?? hostOf(k.input.companyUrl),
          role: k.kit?.role.title ?? '',
          days: k.input.days,
          questionCount: k.kit?.questions.length ?? 0,
          uncoveredMusts: countUncoveredMusts(k.kit),
          createdAt: k.createdAt,
          updatedAt: k.updatedAt,
          error: k.error,
        })),
      });
    }),
  );

  router.get(
    '/:id',
    asyncRoute<AuthedRequest>(async (req, res) => {
      const record = await db.kits.findOwned(req.user.id, req.params.id!);
      if (!record) throw ApiError.notFound('That kit does not exist.');
      const jobs = await db.jobs.findByKit(record.id);
      res.json({
        data: {
          id: record.id,
          status: record.status,
          version: record.version,
          kit: record.kit ? withOrderApplied(record.kit) : null,
          input: record.input,
          error: record.error,
          promptVersion: record.promptVersion,
          stepLog: record.stepLog,
          job: jobs[0] ? { id: jobs[0].id, status: jobs[0].status, steps: jobs[0].steps, error: jobs[0].error } : null,
          updatedAt: record.updatedAt,
        },
      });
    }),
  );

  // --- create --------------------------------------------------------------

  router.post(
    '/',
    generateLimit,
    validate(CreateKitBody),
    asyncRoute<AuthedRequest>(async (req, res) => {
      const body = req.body as CreateKitBody;

      // Idempotency: the same posting submitted twice returns the existing kit rather than
      // paying for a second run ("triggered twice for the same posting").
      const idemKey = createHash('sha256')
        .update(req.user.id)
        .update(body.jd.trim())
        .update(normalizeUrlish(body.company_url))
        .update(String(body.days))
        .digest('hex');

      const existing = await db.kits.findByIdemKey(req.user.id, idemKey);
      if (existing) {
        const jobs = await db.jobs.findByKit(existing.id);
        res.status(200).json({
          data: { kitId: existing.id, jobId: jobs[0]?.id ?? null, deduped: true, status: existing.status },
        });
        return;
      }

      const kitId = randomUUID();
      await db.kits.create({
        id: kitId,
        userId: req.user.id,
        status: 'queued',
        version: 0,
        kit: null,
        stepLog: [],
        idemKey,
        promptVersion: '',
        error: null,
        input: { jd: body.jd, companyUrl: body.company_url, days: body.days },
      });

      const job = await runner.enqueueGenerate({
        kitId,
        userId: req.user.id,
        jd: body.jd,
        companyUrl: body.company_url,
        days: body.days,
      });

      // 202: the work outlives the request.
      res.status(202).json({ data: { kitId, jobId: job.id, deduped: false, status: 'queued' } });
    }),
  );

  /** Batch: "prepare for more than one role at once." Same pipeline, one job each. */
  router.post(
    '/batch',
    generateLimit,
    validate(BatchKitBody),
    asyncRoute<AuthedRequest>(async (req, res) => {
      const { cases } = req.body as BatchKitBody;
      const created: { kitId: string; jobId: string; label: string }[] = [];

      for (const c of cases) {
        const idemKey = createHash('sha256')
          .update(req.user.id)
          .update(c.jd.trim())
          .update(normalizeUrlish(c.company_url))
          .update(String(c.days))
          .digest('hex');
        const existing = await db.kits.findByIdemKey(req.user.id, idemKey);
        if (existing) {
          const jobs = await db.jobs.findByKit(existing.id);
          created.push({ kitId: existing.id, jobId: jobs[0]?.id ?? '', label: c.id ?? hostOf(c.company_url) });
          continue;
        }
        const kitId = randomUUID();
        await db.kits.create({
          id: kitId,
          userId: req.user.id,
          status: 'queued',
          version: 0,
          kit: null,
          stepLog: [],
          idemKey,
          promptVersion: '',
          error: null,
          input: { jd: c.jd, companyUrl: c.company_url, days: c.days },
        });
        const job = await runner.enqueueGenerate({
          kitId,
          userId: req.user.id,
          jd: c.jd,
          companyUrl: c.company_url,
          days: c.days,
        });
        created.push({ kitId, jobId: job.id, label: c.id ?? hostOf(c.company_url) });
      }

      res.status(202).json({ data: { kits: created } });
    }),
  );

  router.delete(
    '/:id',
    asyncRoute<AuthedRequest>(async (req, res) => {
      const removed = await db.kits.deleteOwned(req.user.id, req.params.id!);
      if (!removed) throw ApiError.notFound('That kit does not exist.');
      res.json({ data: { deleted: true } });
    }),
  );

  // --- edit (item-level: no version guard, so parallel edits do not conflict) ---

  router.patch(
    '/:id/items/:itemId',
    validate(PatchItemBody),
    asyncRoute<AuthedRequest>(async (req, res) => {
      const { patch } = req.body as PatchItemBody;
      const itemId = req.params.itemId!;

      const updated = await db.kits.patchKit(req.user.id, req.params.id!, (kit) =>
        applyItemPatch(kit, itemId, patch),
      );
      if (!updated?.kit) throw ApiError.notFound('That kit or item does not exist.');

      const validated = validateKit(updated.kit);
      if (!validated.ok) {
        throw ApiError.badRequest('That edit would make the kit invalid.', [
          ...validated.zodErrors,
          ...validated.issues.map((i) => i.message),
        ]);
      }
      res.json({ data: { kit: withOrderApplied(validated.kit), version: updated.version } });
    }),
  );

  router.patch(
    '/:id/order',
    validate(ReorderBody),
    asyncRoute<AuthedRequest>(async (req, res) => {
      const { section, ids } = req.body as ReorderBody;
      const updated = await db.kits.patchKit(req.user.id, req.params.id!, (kit) => {
        // Reorder writes ONLY the order array — never an item body (§5 rule 6).
        const known = new Set((section === 'questions' ? kit.questions : kit.flashcards).map((i) => i.id));
        const order = ids.filter((id) => known.has(id));
        for (const id of known) if (!order.includes(id)) order.push(id);
        return { ...kit, order: { ...kit.order, [section]: order } };
      });
      if (!updated?.kit) throw ApiError.notFound('That kit does not exist.');
      res.json({ data: { kit: withOrderApplied(updated.kit), version: updated.version } });
    }),
  );

  router.post(
    '/:id/items',
    validate(AddItemBody),
    asyncRoute<AuthedRequest>(async (req, res) => {
      const body = req.body as AddItemBody;
      const updated = await db.kits.patchKit(req.user.id, req.params.id!, (kit) => {
        if (body.section === 'questions' && body.question) {
          const id = idAllocator('q', kit.questions.map((q) => q.id))();
          // origin:'manual' — a hand-written question survives every future regeneration.
          const draft: Question = {
            id,
            requirement_ids: body.question.requirement_ids.length ? body.question.requirement_ids : [],
            category: body.question.category,
            prompt: body.question.prompt,
            answer_outline: body.question.answer_outline ?? '',
            difficulty: body.question.difficulty ?? 2,
          };
          const question = markManual(draft);
          const questions = [...kit.questions, question];
          const reconciled = reconcileSchedule(kit.schedule.days, questions, kit.role.requirements);
          return {
            ...kit,
            questions,
            schedule: { ...kit.schedule, days: reconciled.days },
            coverage: summarizeCoverage(kit.role.requirements, questions, kit.coverage.passes),
            order: { ...kit.order, questions: [...(kit.order?.questions ?? kit.questions.map((q) => q.id)), id] },
          };
        }
        if (body.section === 'flashcards' && body.flashcard) {
          const id = idAllocator('f', kit.flashcards.map((f) => f.id))();
          const draft: Flashcard = {
            id,
            front: body.flashcard.front,
            back: body.flashcard.back ?? '',
            requirement_ids: body.flashcard.requirement_ids ?? [],
          };
          const card = markManual(draft);
          return {
            ...kit,
            flashcards: [...kit.flashcards, card],
            order: { ...kit.order, flashcards: [...(kit.order?.flashcards ?? kit.flashcards.map((f) => f.id)), id] },
          };
        }
        return kit;
      });
      if (!updated?.kit) throw ApiError.notFound('That kit does not exist.');
      const validated = validateKit(updated.kit);
      if (!validated.ok) throw ApiError.badRequest('That item would make the kit invalid.', validated.zodErrors);
      res.status(201).json({ data: { kit: withOrderApplied(validated.kit), version: updated.version } });
    }),
  );

  router.delete(
    '/:id/items/:itemId',
    asyncRoute<AuthedRequest>(async (req, res) => {
      const itemId = req.params.itemId!;
      const updated = await db.kits.patchKit(req.user.id, req.params.id!, (kit) => {
        const questions = kit.questions.filter((q) => q.id !== itemId);
        const flashcards = kit.flashcards.filter((f) => f.id !== itemId);
        const reconciled = reconcileSchedule(kit.schedule.days, questions, kit.role.requirements);
        return {
          ...kit,
          questions,
          flashcards,
          schedule: { ...kit.schedule, days: reconciled.days },
          coverage: summarizeCoverage(kit.role.requirements, questions, kit.coverage.passes),
          order: {
            ...kit.order,
            questions: (kit.order?.questions ?? []).filter((id) => id !== itemId),
            flashcards: (kit.order?.flashcards ?? []).filter((id) => id !== itemId),
          },
        };
      });
      if (!updated?.kit) throw ApiError.notFound('That kit or item does not exist.');
      const validated = validateKit(updated.kit);
      if (!validated.ok) {
        throw ApiError.badRequest(
          'Deleting that would leave a must-have requirement uncovered.',
          validated.issues.map((i) => i.message),
        );
      }
      res.json({ data: { kit: withOrderApplied(validated.kit), version: updated.version } });
    }),
  );

  // --- regenerate one section ---------------------------------------------

  router.post(
    '/:id/regenerate',
    generateLimit,
    validate(RegenerateBody),
    asyncRoute<AuthedRequest>(async (req, res) => {
      const { scope } = req.body as RegenerateBody;
      const record = await db.kits.findOwned(req.user.id, req.params.id!);
      if (!record?.kit) throw ApiError.notFound('That kit does not exist yet.');

      const job = await runner.enqueueRegenerate({ kitId: record.id, userId: req.user.id, scope });
      res.status(202).json({ data: { jobId: job.id, scope } });
    }),
  );

  // --- practice + weak spots ----------------------------------------------

  router.post(
    '/:id/practice',
    validate(PracticeBody),
    asyncRoute<AuthedRequest>(async (req, res) => {
      const body = req.body as PracticeBody;
      const record = await db.kits.findOwned(req.user.id, req.params.id!);
      if (!record?.kit) throw ApiError.notFound('That kit does not exist.');
      if (!record.kit.flashcards.some((f) => f.id === body.cardId)) {
        throw ApiError.badRequest('That flashcard is not in this kit.');
      }
      await db.practice.record({
        userId: req.user.id,
        kitId: record.id,
        cardId: body.cardId,
        confidence: body.confidence,
        at: new Date().toISOString(),
      });
      const events = await db.practice.listForKit(req.user.id, record.id);
      res.json({ data: { events: events.map((e) => ({ cardId: e.cardId, confidence: e.confidence, at: e.at })) } });
    }),
  );

  router.get(
    '/:id/practice',
    asyncRoute<AuthedRequest>(async (req, res) => {
      const record = await db.kits.findOwned(req.user.id, req.params.id!);
      if (!record) throw ApiError.notFound('That kit does not exist.');
      const events = await db.practice.listForKit(req.user.id, record.id);
      res.json({ data: { events: events.map((e) => ({ cardId: e.cardId, confidence: e.confidence, at: e.at })) } });
    }),
  );

  router.get(
    '/:id/weak-spots',
    asyncRoute<AuthedRequest>(async (req, res) => {
      const record = await db.kits.findOwned(req.user.id, req.params.id!);
      if (!record?.kit) throw ApiError.notFound('That kit does not exist yet.');
      const events = await db.practice.listForKit(req.user.id, record.id);
      const report = weakSpots(record.kit, events);
      const plan = weakSpotPlan(record.kit, events, 1, 5);
      res.json({ data: { ...report, plan: plan.days } });
    }),
  );

  return router;
}

// --- helpers ---------------------------------------------------------------

/** The stored `order` array is the user's arrangement; apply it on the way out. */
function withOrderApplied(kit: Kit): Kit {
  return {
    ...kit,
    questions: applyOrder(kit.questions, kit.order?.questions),
    flashcards: applyOrder(kit.flashcards, kit.order?.flashcards),
  };
}

/** Any edit marks the item origin:'edited', which protects it from regeneration (§5). */
function applyItemPatch(kit: Kit, itemId: string, patch: PatchItemBody['patch']): Kit {
  const question = kit.questions.find((q) => q.id === itemId);
  if (question) {
    const next = {
      ...question,
      ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
      ...(patch.answer_outline !== undefined ? { answer_outline: patch.answer_outline } : {}),
      ...(patch.difficulty !== undefined ? { difficulty: patch.difficulty } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
    };
    // A pin alone is not an edit: it protects the model's wording as-is.
    const marked =
      patch.pinned !== undefined && Object.keys(patch).length === 1
        ? { ...next, meta: { ...(next.meta ?? { origin: 'generated' as const, updated_at: '' }), pinned: patch.pinned, updated_at: new Date().toISOString() } }
        : markEdited(next);
    const withPin = patch.pinned !== undefined ? { ...marked, meta: { ...marked.meta!, pinned: patch.pinned } } : marked;
    const questions = kit.questions.map((q) => (q.id === itemId ? withPin : q));
    // Category can move a question between tabs, so the schedule may need reconciling.
    const reconciled = reconcileSchedule(kit.schedule.days, questions, kit.role.requirements);
    return { ...kit, questions, schedule: { ...kit.schedule, days: reconciled.days } };
  }

  const card = kit.flashcards.find((f) => f.id === itemId);
  if (card) {
    const next = {
      ...card,
      ...(patch.front !== undefined ? { front: patch.front } : {}),
      ...(patch.back !== undefined ? { back: patch.back } : {}),
    };
    const marked = markEdited(next);
    const withPin = patch.pinned !== undefined ? { ...marked, meta: { ...marked.meta!, pinned: patch.pinned } } : marked;
    return { ...kit, flashcards: kit.flashcards.map((f) => (f.id === itemId ? withPin : f)) };
  }

  // A schedule day: editing its focus FREEZES it against reconciliation (§5.1).
  const dayNumber = Number(itemId.replace(/^day-/, ''));
  const day = kit.schedule.days.find((d) => d.day === dayNumber);
  if (day && patch.focus !== undefined) {
    const days = kit.schedule.days.map((d) =>
      d.day === dayNumber
        ? { ...d, focus: patch.focus!, meta: { origin: 'edited' as const, pinned: d.meta?.pinned ?? false, updated_at: new Date().toISOString() } }
        : d,
    );
    return { ...kit, schedule: { ...kit.schedule, days } };
  }

  if (itemId === 'company_brief' && (patch.summary !== undefined || patch.what_they_do !== undefined)) {
    return {
      ...kit,
      company_brief: {
        ...kit.company_brief,
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.what_they_do !== undefined ? { what_they_do: patch.what_they_do } : {}),
      },
    };
  }

  return kit;
}

const countUncoveredMusts = (kit: Kit | null): number =>
  kit
    ? kit.coverage.uncovered_requirement_ids.filter((id) =>
        kit.role.requirements.some((r) => r.id === id && r.priority === 'must'),
      ).length
    : 0;

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

/** Normalises for the idempotency key only — not for fetching. */
const normalizeUrlish = (u: string): string => u.trim().toLowerCase().replace(/\/+$/, '');
