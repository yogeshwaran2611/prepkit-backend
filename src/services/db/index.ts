export * from './types.js';
export { createMongoDb } from './mongo.js';
export { createFileDb, defaultFileDbPath } from './file.js';

import type { Db } from './types.js';
import { createFileDb, defaultFileDbPath } from './file.js';
import { createMongoDb } from './mongo.js';

/**
 * Mongo when MONGODB_URI is set (the deployment path), the JSON file store otherwise (so a
 * clean clone runs with no services installed). One interface, chosen once, at the edge.
 */
export async function openDb(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<Db> {
  if (env.MONGODB_URI) return createMongoDb(env.MONGODB_URI, env.MONGODB_DB ?? 'prepkit');
  return createFileDb(env.FILE_DB_PATH ?? defaultFileDbPath(cwd));
}
