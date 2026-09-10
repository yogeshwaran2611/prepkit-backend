import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MemoryCache } from '../pipeline/index.js';
import { GeminiProvider } from './gemini.js';

/**
 * The cache policy is worth pinning down because getting it wrong breaks the single
 * most-demoed feature: a prompt-keyed cache would return byte-identical questions on a
 * regeneration, making the button look like a no-op.
 */

/**
 * The real global fetch is restored after every test. Leaving a stub installed is a
 * cross-test hazard: any other file (or a later test here) that reaches the network would
 * silently talk to the stub instead, which is the kind of flake that wastes an afternoon.
 */
const realFetch = globalThis.fetch;
beforeAll(() => {
  // nothing to set up; the reference above is what matters
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

let calls = 0;
const server = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  headers: new Headers(),
  json: async () => body,
});

/** Replaces global fetch with a counting stub. */
function stubFetch(reply: () => unknown) {
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return server(reply()) as unknown as Response;
  }) as typeof fetch;
}

const okReply = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  modelVersion: 'test-model',
});

describe('GeminiProvider cache policy', () => {
  it('serves a repeat of the same call from cache', async () => {
    stubFetch(() => okReply('{"a":1}'));
    const provider = new GeminiProvider({ apiKey: 'k', cache: new MemoryCache() });

    const first = await provider.complete({ user: 'same prompt' });
    const second = await provider.complete({ user: 'same prompt' });

    expect(calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.text).toBe(first.text);
  });

  /**
   * The headline behaviour: a regeneration passes a cacheSalt, which must produce a real
   * second call rather than replaying the cached section.
   */
  it('BYPASSES the cache when a cacheSalt is present', async () => {
    let n = 0;
    stubFetch(() => okReply(`{"n":${++n}}`));
    const provider = new GeminiProvider({ apiKey: 'k', cache: new MemoryCache() });

    const first = await provider.complete({ user: 'same prompt' });
    const regenerated = await provider.complete({ user: 'same prompt', cacheSalt: 'job-123' });

    expect(calls).toBe(2);
    expect(regenerated.cached).toBe(false);
    expect(regenerated.text).not.toBe(first.text);
  });

  it('treats different salts as different calls', async () => {
    stubFetch(() => okReply('{"a":1}'));
    const provider = new GeminiProvider({ apiKey: 'k', cache: new MemoryCache() });
    await provider.complete({ user: 'p', cacheSalt: 'job-1' });
    await provider.complete({ user: 'p', cacheSalt: 'job-2' });
    expect(calls).toBe(2);
  });

  /**
   * Regression: offline mode only gated the fetcher, so a cache miss reached the network and
   * failed with the provider's message about credentials — which explains nothing and made
   * the documented `--offline` guarantee false.
   */
  it('offline mode fails loudly on a cache miss instead of calling the network', async () => {
    stubFetch(() => okReply('{"a":1}'));
    const provider = new GeminiProvider({ apiKey: '', cache: new MemoryCache(), offline: true });

    await expect(provider.complete({ user: 'never cached' })).rejects.toThrow(/offline mode/i);
    expect(calls).toBe(0);
  });

  it('offline mode still serves a cache hit', async () => {
    const cache = new MemoryCache();
    stubFetch(() => okReply('{"cached":true}'));
    const online = new GeminiProvider({ apiKey: 'k', cache });
    await online.complete({ user: 'seeded' });

    stubFetch(() => okReply('{"should":"not happen"}'));
    const offline = new GeminiProvider({ apiKey: '', cache, offline: true });
    const hit = await offline.complete({ user: 'seeded' });

    expect(hit.cached).toBe(true);
    expect(hit.text).toBe('{"cached":true}');
    expect(calls).toBe(0);
  });

  it('retries a 503 and then succeeds', async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      if (n === 1) return server({ error: { message: 'high demand' } }, 503) as unknown as Response;
      return server(okReply('{"ok":1}')) as unknown as Response;
    }) as typeof fetch;

    const provider = new GeminiProvider({ apiKey: 'k' });
    const res = await provider.complete({ user: 'p' });
    expect(res.text).toBe('{"ok":1}');
    expect(n).toBe(2);
  });

  it('does not retry a 400 schema rejection', async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      return server({ error: { message: 'Invalid JSON payload' } }, 400) as unknown as Response;
    }) as typeof fetch;

    const provider = new GeminiProvider({ apiKey: 'k' });
    await expect(provider.complete({ user: 'p' })).rejects.toThrow();
    expect(n).toBe(1);
  });

  it('drops thinkingConfig and retries when a model rejects it', async () => {
    const bodies: string[] = [];
    let n = 0;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      n++;
      if (n === 1) {
        return server({ error: { message: 'thinkingConfig is not supported' } }, 400) as unknown as Response;
      }
      return server(okReply('{"ok":1}')) as unknown as Response;
    }) as unknown as typeof fetch;

    const provider = new GeminiProvider({ apiKey: 'k' });
    const res = await provider.complete({ user: 'p' });
    expect(res.text).toBe('{"ok":1}');
    expect(bodies[0]).toContain('thinkingConfig');
    expect(bodies[1]).not.toContain('thinkingConfig');
  });
});
