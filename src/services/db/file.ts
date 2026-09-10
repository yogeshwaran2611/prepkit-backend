import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Kit, KitNote } from '../../schemas/index.js';
import type { Db, JobRecord, KitRecord, KitStatus, PracticeEventRecord, UserRecord } from './types.js';

/**
 * A JSON-file implementation of the same repositories.
 *
 * Why it exists: MongoDB Atlas is the deployment target, but a reviewer cloning this repo
 * should be able to run the whole app — signup, generate, edit, practise — with
 * `npm run dev` and nothing else installed. Setting MONGODB_URI switches to Mongo; leaving
 * it unset uses this.
 *
 * It is honest about its limits: a single process, a whole-file write under one in-process
 * lock. That is correct for local development and explicitly NOT the production path.
 * ponytail: one lock for the whole file. Per-collection locks only if dev throughput ever matters.
 */

interface Shape {
  users: UserRecord[];
  kits: KitRecord[];
  jobs: JobRecord[];
  practice: PracticeEventRecord[];
  cache: Record<string, string>;
}

const EMPTY: Shape = { users: [], kits: [], jobs: [], practice: [], cache: {} };

export async function createFileDb(path: string): Promise<Db> {
  let state: Shape = EMPTY;
  try {
    state = { ...EMPTY, ...(JSON.parse(await readFile(path, 'utf8')) as Partial<Shape>) };
  } catch {
    await mkdir(dirname(path), { recursive: true });
  }

  // Serialises writes so two concurrent requests cannot clobber the file.
  let writing: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    writing = writing.then(async () => {
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
      await rename(tmp, path);
    });
    return writing;
  };

  const now = () => new Date().toISOString();
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

  return {
    kind: 'file',

    users: {
      async findByEmail(email) {
        return clone(state.users.find((u) => u.email === email.toLowerCase()) ?? null);
      },
      async findById(id) {
        return clone(state.users.find((u) => u.id === id) ?? null);
      },
      async create(user) {
        const record: UserRecord = { ...user, email: user.email.toLowerCase(), id: randomUUID(), createdAt: now() };
        state.users.push(record);
        await persist();
        return clone(record);
      },
    },

    kits: {
      async findOwned(userId, id) {
        return clone(state.kits.find((k) => k.id === id && k.userId === userId) ?? null);
      },
      async listOwned(userId) {
        return clone(
          state.kits.filter((k) => k.userId === userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        );
      },
      async findByIdemKey(userId, idemKey) {
        return clone(state.kits.find((k) => k.userId === userId && k.idemKey === idemKey) ?? null);
      },
      async create(record) {
        const full: KitRecord = { ...record, createdAt: now(), updatedAt: now() };
        state.kits.push(full);
        await persist();
        return clone(full);
      },
      async replaceKit(userId, id, expectedVersion, kit, notes) {
        const found = state.kits.find((k) => k.id === id && k.userId === userId);
        if (!found) return null;
        if (found.version !== expectedVersion) return null; // stale -> caller returns 409
        found.kit = notes ? ({ ...kit, notes } as Kit) : kit;
        found.version += 1;
        found.updatedAt = now();
        await persist();
        return clone(found);
      },
      async patchKit(userId, id, mutate) {
        const found = state.kits.find((k) => k.id === id && k.userId === userId);
        if (!found?.kit) return null;
        found.kit = mutate(clone(found.kit));
        found.updatedAt = now();
        await persist();
        return clone(found);
      },
      async setStatus(id, status: KitStatus, patch) {
        const found = state.kits.find((k) => k.id === id);
        if (!found) return;
        Object.assign(found, { status, ...(patch ?? {}), updatedAt: now() });
        await persist();
      },
      async deleteOwned(userId, id) {
        const before = state.kits.length;
        state.kits = state.kits.filter((k) => !(k.id === id && k.userId === userId));
        const removed = state.kits.length < before;
        if (removed) await persist();
        return removed;
      },
    },

    jobs: {
      async create(job) {
        const full: JobRecord = { ...job, createdAt: now(), updatedAt: now() };
        state.jobs.push(full);
        await persist();
        return clone(full);
      },
      async findOwned(userId, id) {
        return clone(state.jobs.find((j) => j.id === id && j.userId === userId) ?? null);
      },
      async findByKit(kitId) {
        return clone(
          state.jobs.filter((j) => j.kitId === kitId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        );
      },
      async update(id, patch) {
        const found = state.jobs.find((j) => j.id === id);
        if (!found) return;
        Object.assign(found, patch, { updatedAt: now() });
        await persist();
      },
      async appendStep(id, step) {
        const found = state.jobs.find((j) => j.id === id);
        if (!found) return;
        found.steps.push(step);
        found.updatedAt = now();
        await persist();
      },
      async reclaimExpired(nowIso) {
        const stuck = state.jobs.filter((j) => j.status === 'running' && j.leaseUntil && j.leaseUntil < nowIso);
        for (const j of stuck) {
          j.status = 'failed';
          j.error = { code: 'INTERNAL', message: 'The server restarted while this kit was generating.' };
          j.updatedAt = nowIso;
        }
        if (stuck.length) await persist();
        return clone(stuck);
      },
    },

    practice: {
      async record(event) {
        state.practice.push({ ...event, id: randomUUID() });
        await persist();
      },
      async listForKit(userId, kitId) {
        return clone(
          state.practice.filter((p) => p.userId === userId && p.kitId === kitId).sort((a, b) => a.at.localeCompare(b.at)),
        );
      },
    },

    cache: {
      async get(k) {
        return state.cache[k];
      },
      async set(k, v) {
        state.cache[k] = v;
        await persist();
      },
    },

    async close() {
      await writing;
    },
  };
}

export const defaultFileDbPath = (cwd: string): string => join(cwd, '.data', 'prepkit.json');
