import { MongoClient, type Collection, type Db as MongoDb } from 'mongodb';
import { randomUUID } from 'node:crypto';
import type { Kit, KitNote } from '../../schemas/index.js';
import type { StepEvent } from '../../utils/pipeline/index.js';
import type {
  Db,
  JobRecord,
  KitRecord,
  KitStatus,
  PracticeEventRecord,
  UserRecord,
} from './types.js';

/**
 * MongoDB implementation. PLAN.md §6.3.
 *
 * The official driver, not Mongoose: Zod already validates at every boundary, so a Mongoose
 * schema would be a second source of truth that can disagree with the first.
 */

export async function createMongoDb(uri: string, dbName: string): Promise<Db> {
  const client = new MongoClient(uri, {
    // A serverless-friendly pool: this API runs as one small instance.
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8_000,
    retryWrites: true,
  });
  await client.connect();
  const db = client.db(dbName);
  await ensureIndexes(db);

  const users = db.collection<UserRecord>('users');
  const kits = db.collection<KitRecord>('kits');
  const jobs = db.collection<JobRecord>('jobs');
  const practice = db.collection<PracticeEventRecord>('practice_events');
  const cache = db.collection<{ _id: string; value: string; createdAt: Date }>('cache');

  const now = () => new Date().toISOString();
  const strip = <T extends { _id?: unknown }>(doc: T | null): T | null => {
    if (!doc) return null;
    const { _id, ...rest } = doc as T & { _id?: unknown };
    void _id;
    return rest as T;
  };

  return {
    kind: 'mongo',

    users: {
      async findByEmail(email) {
        return strip(await users.findOne({ email: email.toLowerCase() }));
      },
      async findById(id) {
        return strip(await users.findOne({ id }));
      },
      async create(user) {
        const record: UserRecord = { ...user, email: user.email.toLowerCase(), id: randomUUID(), createdAt: now() };
        await users.insertOne(record as UserRecord & { _id?: never });
        return record;
      },
    },

    kits: {
      // Every query carries userId — ownership cannot be forgotten by a caller.
      async findOwned(userId, id) {
        return strip(await kits.findOne({ id, userId }));
      },
      async listOwned(userId) {
        const docs = await kits.find({ userId }).sort({ updatedAt: -1 }).limit(100).toArray();
        return docs.map((d) => strip(d)!).filter(Boolean);
      },
      async findByIdemKey(userId, idemKey) {
        return strip(await kits.findOne({ userId, idemKey }));
      },
      async create(record) {
        const full: KitRecord = { ...record, createdAt: now(), updatedAt: now() };
        await kits.insertOne(full as KitRecord & { _id?: never });
        return full;
      },
      async replaceKit(userId, id, expectedVersion, kit, notes) {
        const patched = notes ? ({ ...kit, notes } as Kit) : kit;
        const res = await kits.findOneAndUpdate(
          { id, userId, version: expectedVersion },
          { $set: { kit: patched, updatedAt: now() }, $inc: { version: 1 } },
          { returnDocument: 'after' },
        );
        return strip(res);
      },
      async patchKit(userId, id, mutate) {
        // Item-level write: read, mutate, write without a version guard so two edits to
        // different items do not spuriously conflict (§5 scoped concurrency).
        const current = await kits.findOne({ id, userId });
        if (!current?.kit) return null;
        const next = mutate(current.kit);
        const res = await kits.findOneAndUpdate(
          { id, userId },
          { $set: { kit: next, updatedAt: now() } },
          { returnDocument: 'after' },
        );
        return strip(res);
      },
      async setStatus(id, status: KitStatus, patch) {
        await kits.updateOne({ id }, { $set: { status, ...(patch ?? {}), updatedAt: now() } });
      },
      async deleteOwned(userId, id) {
        const res = await kits.deleteOne({ id, userId });
        return res.deletedCount === 1;
      },
    },

    jobs: {
      async create(job) {
        const full: JobRecord = { ...job, createdAt: now(), updatedAt: now() };
        await jobs.insertOne(full as JobRecord & { _id?: never });
        return full;
      },
      async findOwned(userId, id) {
        return strip(await jobs.findOne({ id, userId }));
      },
      async findByKit(kitId) {
        const docs = await jobs.find({ kitId }).sort({ createdAt: -1 }).toArray();
        return docs.map((d) => strip(d)!).filter(Boolean);
      },
      async update(id, patch) {
        await jobs.updateOne({ id }, { $set: { ...patch, updatedAt: now() } });
      },
      async appendStep(id, step: StepEvent) {
        await jobs.updateOne({ id }, { $push: { steps: step }, $set: { updatedAt: now() } });
      },
      async reclaimExpired(nowIso) {
        const stuck = await jobs.find({ status: 'running', leaseUntil: { $lt: nowIso } }).toArray();
        if (stuck.length) {
          await jobs.updateMany(
            { id: { $in: stuck.map((s) => s.id) } },
            {
              $set: {
                status: 'failed',
                error: { code: 'INTERNAL', message: 'The server restarted while this kit was generating.' },
                updatedAt: nowIso,
              },
            },
          );
        }
        return stuck.map((d) => strip(d)!).filter(Boolean);
      },
    },

    practice: {
      async record(event) {
        await practice.insertOne({ ...event, id: randomUUID() } as PracticeEventRecord & { _id?: never });
      },
      async listForKit(userId, kitId) {
        const docs = await practice.find({ userId, kitId }).sort({ at: 1 }).limit(5_000).toArray();
        return docs.map((d) => strip(d)!).filter(Boolean);
      },
      async clearForKit(userId, kitId) {
        await practice.deleteMany({ userId, kitId });
      },
    },

    cache: {
      async get(k) {
        const doc = await cache.findOne({ _id: k });
        return doc?.value;
      },
      async set(k, v) {
        await cache.updateOne({ _id: k }, { $set: { value: v, createdAt: new Date() } }, { upsert: true });
      },
    },

    async close() {
      await client.close();
    },
  };
}

async function ensureIndexes(db: MongoDb): Promise<void> {
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('users').createIndex({ id: 1 }, { unique: true }),
    db.collection('kits').createIndex({ id: 1 }, { unique: true }),
    db.collection('kits').createIndex({ userId: 1, updatedAt: -1 }),
    // Sparse + unique: dedupes a double submit without blocking kits that predate the key.
    db.collection('kits').createIndex({ userId: 1, idemKey: 1 }, { unique: true, sparse: true }),
    db.collection('jobs').createIndex({ id: 1 }, { unique: true }),
    db.collection('jobs').createIndex({ status: 1, leaseUntil: 1 }),
    db.collection('jobs').createIndex({ kitId: 1, createdAt: -1 }),
    db.collection('practice_events').createIndex({ userId: 1, kitId: 1, at: -1 }),
    // Cached model/page responses expire on their own; no cleanup job to forget.
    db.collection('cache').createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }),
  ] as Promise<unknown>[]).catch(() => {
    // Index creation races between instances are harmless; a failure here must not stop boot.
  });
}

export type { Collection };
