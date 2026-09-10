import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CacheStore } from '../pipeline/index.js';

/**
 * On-disk cache used by the CLI. Committed to the repo (`.cache/`) so that
 * `npm run evaluate -- --offline` works from a clean clone with no API key at all —
 * see PLAN.md §9.
 */
export class FileCache implements CacheStore {
  constructor(private readonly dir: string) {}

  private path(key: string): string {
    const hash = createHash('sha256').update(key).digest('hex');
    return join(this.dir, hash.slice(0, 2), `${hash}.json`);
  }

  async get(key: string): Promise<string | undefined> {
    try {
      const raw = await readFile(this.path(key), 'utf8');
      return (JSON.parse(raw) as { value: string }).value;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify({ key: key.slice(0, 200), value }, null, 0), 'utf8');
  }
}
