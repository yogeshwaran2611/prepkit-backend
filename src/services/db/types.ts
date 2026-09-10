import type { Kit, KitNote } from '../../schemas/index.js';
import type { StepEvent } from '../../utils/pipeline/index.js';

/** PLAN.md §6.3 — repositories expose intent, not queries. */

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export type KitStatus = 'queued' | 'running' | 'ready' | 'failed';

export interface KitRecord {
  id: string;
  userId: string;
  status: KitStatus;
  /** Optimistic-concurrency guard for SECTION-level writes only (§5). */
  version: number;
  kit: Kit | null;
  stepLog: StepEvent[];
  /** sha256(userId + jd + url + days) — dedupes a double submit (§6.2). */
  idemKey: string;
  promptVersion: string;
  error: { code: string; message: string } | null;
  /** Kept so a kit can be reopened, continued, and regenerated later. */
  input: { jd: string; companyUrl: string; days: number };
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = 'queued' | 'running' | 'ok' | 'failed';

export interface JobRecord {
  id: string;
  kitId: string;
  userId: string;
  type: 'generate' | 'regenerate';
  scope: string | null;
  status: JobStatus;
  steps: StepEvent[];
  error: { code: string; message: string } | null;
  /** A job whose lease expires is reconciled on boot (§6.2 crash recovery). */
  leaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeEventRecord {
  id: string;
  userId: string;
  kitId: string;
  cardId: string;
  confidence: 1 | 2 | 3;
  at: string;
}

export interface UserRepo {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(user: Omit<UserRecord, 'id' | 'createdAt'>): Promise<UserRecord>;
}

export interface KitRepo {
  /**
   * Ownership is a REPOSITORY-level filter, not a controller `if`. That is how "users can
   * read and modify only their own kits" stops being something a route can forget.
   */
  findOwned(userId: string, id: string): Promise<KitRecord | null>;
  listOwned(userId: string): Promise<KitRecord[]>;
  findByIdemKey(userId: string, idemKey: string): Promise<KitRecord | null>;
  create(record: Omit<KitRecord, 'createdAt' | 'updatedAt'>): Promise<KitRecord>;
  /** Section-level write: fails if `expectedVersion` is stale (409 to the client). */
  replaceKit(userId: string, id: string, expectedVersion: number, kit: Kit, notes?: KitNote[]): Promise<KitRecord | null>;
  /** Item-level write: no version guard, so concurrent edits to different items both win. */
  patchKit(userId: string, id: string, mutate: (kit: Kit) => Kit): Promise<KitRecord | null>;
  setStatus(id: string, status: KitStatus, patch?: Partial<Pick<KitRecord, 'kit' | 'stepLog' | 'error' | 'promptVersion'>>): Promise<void>;
  deleteOwned(userId: string, id: string): Promise<boolean>;
}

export interface JobRepo {
  create(job: Omit<JobRecord, 'createdAt' | 'updatedAt'>): Promise<JobRecord>;
  findOwned(userId: string, id: string): Promise<JobRecord | null>;
  findByKit(kitId: string): Promise<JobRecord[]>;
  update(id: string, patch: Partial<JobRecord>): Promise<void>;
  appendStep(id: string, step: StepEvent): Promise<void>;
  /** Boot-time reconciliation of anything a restart interrupted. */
  reclaimExpired(now: string): Promise<JobRecord[]>;
}

export interface PracticeRepo {
  record(event: Omit<PracticeEventRecord, 'id'>): Promise<void>;
  listForKit(userId: string, kitId: string): Promise<PracticeEventRecord[]>;
}

export interface Db {
  users: UserRepo;
  kits: KitRepo;
  jobs: JobRepo;
  practice: PracticeRepo;
  cache: { get(k: string): Promise<string | undefined>; set(k: string, v: string): Promise<void> };
  close(): Promise<void>;
  readonly kind: 'mongo' | 'file';
}
