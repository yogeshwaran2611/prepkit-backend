import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './services/db/index.js';
import { createFileDb } from './services/db/index.js';
import { createApp } from './app.js';
import { loadConfig, type Config } from './config/index.js';

/**
 * API integration tests. PLAN.md §11.
 *
 * These cover the boundary behaviours that are easy to get wrong and expensive to get wrong:
 * ownership, session handling, idempotency, cookie flags in both deployment modes, and CORS
 * with credentials.
 */

let db: Db;
let dir: string;
let app: ReturnType<typeof createApp>['express'];
let config: Config;

const ENV_BASE = {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret-that-is-definitely-long-enough-32',
  CORS_ORIGINS: 'http://localhost:3000',
  GEMINI_API_KEY: '',
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prepkit-test-'));
  db = await createFileDb(join(dir, 'db.json'));
  config = loadConfig({ ...ENV_BASE, COOKIE_MODE: 'same-site' } as NodeJS.ProcessEnv);
  app = createApp(config, db).express;
});

afterAll(async () => {
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

const register = async (email: string) => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'a-long-enough-password' })
    .expect(201);
  const cookie = res.headers['set-cookie'] as unknown as string[];
  return { cookie, id: res.body.data.id as string };
};

describe('health', () => {
  it('reports what is configured without leaking secrets', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.store).toBe('file');
    expect(JSON.stringify(res.body)).not.toContain(ENV_BASE.JWT_SECRET);
  });
});

describe('auth', () => {
  it('registers, sets an httpOnly cookie, and returns the user', async () => {
    const { cookie } = await register('a@example.com');
    expect(cookie.join(';')).toMatch(/HttpOnly/i);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.data.email).toBe('a@example.com');
  });

  it('rejects a duplicate email with a useful message', async () => {
    await register('dupe@example.com');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dupe@example.com', password: 'a-long-enough-password' })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects a weak password with a field-level message', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'x@example.com', password: 'short' }).expect(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
    expect(JSON.stringify(res.body.error.details)).toContain('password');
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await register('known@example.com');
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'known@example.com', password: 'not-the-password' })
      .expect(401);
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'not-the-password' })
      .expect(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('logs in and out', async () => {
    await register('inout@example.com');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inout@example.com', password: 'a-long-enough-password' })
      .expect(200);
    const cookie = login.headers['set-cookie'] as unknown as string[];
    await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(200);
  });

  it('treats a tampered or expired token as "sign in again", not a crash', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', ['prepkit_session=not.a.real.jwt'])
      .expect(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('refuses protected routes with no session', async () => {
    const res = await request(app).get('/api/kits').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('ownership — users can only see their own kits', () => {
  it('returns 404, not 403, for another user’s kit', async () => {
    const alice = await register('alice@example.com');
    const bob = await register('bob@example.com');

    const created = await request(app)
      .post('/api/kits')
      .set('Cookie', alice.cookie)
      .send({ jd: 'Engineer with Node.js experience required', company_url: 'http://localhost:8099/acme/', days: 3 })
      .expect(202);
    const kitId = created.body.data.kitId as string;

    // 404 rather than 403: a 403 would confirm the resource exists.
    await request(app).get(`/api/kits/${kitId}`).set('Cookie', bob.cookie).expect(404);
    await request(app).delete(`/api/kits/${kitId}`).set('Cookie', bob.cookie).expect(404);

    const bobList = await request(app).get('/api/kits').set('Cookie', bob.cookie).expect(200);
    expect(bobList.body.data).toHaveLength(0);

    const aliceList = await request(app).get('/api/kits').set('Cookie', alice.cookie).expect(200);
    expect(aliceList.body.data).toHaveLength(1);
  });
});

describe('idempotency — "triggered twice for the same posting"', () => {
  it('returns the existing kit instead of paying for a second run', async () => {
    const user = await register('idem@example.com');
    const body = { jd: 'Backend Engineer with Go experience required', company_url: 'http://localhost:8099/acme/', days: 4 };

    const first = await request(app).post('/api/kits').set('Cookie', user.cookie).send(body).expect(202);
    const second = await request(app).post('/api/kits').set('Cookie', user.cookie).send(body).expect(200);

    expect(second.body.data.deduped).toBe(true);
    expect(second.body.data.kitId).toBe(first.body.data.kitId);
  });

  it('treats a different day count as a different kit', async () => {
    const user = await register('idem2@example.com');
    const base = { jd: 'Backend Engineer with Rust experience required', company_url: 'http://localhost:8099/acme/' };
    const a = await request(app).post('/api/kits').set('Cookie', user.cookie).send({ ...base, days: 3 }).expect(202);
    const b = await request(app).post('/api/kits').set('Cookie', user.cookie).send({ ...base, days: 9 }).expect(202);
    expect(b.body.data.kitId).not.toBe(a.body.data.kitId);
  });
});

describe('validation', () => {
  it('rejects a day count outside 1..60 with a readable message', async () => {
    const user = await register('days@example.com');
    for (const days of [0, 61, -1]) {
      const res = await request(app)
        .post('/api/kits')
        .set('Cookie', user.cookie)
        .send({ jd: 'Engineer', company_url: 'http://x.test/', days })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects an empty job description', async () => {
    const user = await register('empty@example.com');
    await request(app)
      .post('/api/kits')
      .set('Cookie', user.cookie)
      .send({ jd: '', company_url: 'http://x.test/', days: 3 })
      .expect(400);
  });

  it('rejects an unsupported regenerate scope', async () => {
    const user = await register('scope@example.com');
    const created = await request(app)
      .post('/api/kits')
      .set('Cookie', user.cookie)
      .send({ jd: 'Engineer with Node.js required', company_url: 'http://localhost:8099/acme/', days: 3 })
      .expect(202);
    const res = await request(app)
      .post(`/api/kits/${created.body.data.kitId}/regenerate`)
      .set('Cookie', user.cookie)
      .send({ scope: 'everything' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('returns a structured 404 for an unknown endpoint', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('CORS with credentials', () => {
  it('echoes an allowed origin and never uses a wildcard', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not echo an origin outside the allowlist', async () => {
    const res = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('cookie flags in both deployment modes', () => {
  /**
   * The trap this exists for: Vercel and a separate API host are different registrable
   * domains, so every request is cross-site and a SameSite=Lax cookie is silently NOT sent.
   * Local dev passes; production is permanently logged out.
   */
  it('same-site mode uses SameSite=Lax', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'lax@example.com', password: 'a-long-enough-password' })
      .expect(201);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('cross-site mode uses SameSite=None with Secure', async () => {
    const crossConfig = loadConfig({ ...ENV_BASE, COOKIE_MODE: 'cross-site' } as NodeJS.ProcessEnv);
    const crossApp = createApp(crossConfig, db).express;
    const res = await request(crossApp)
      .post('/api/auth/register')
      .set('Origin', 'http://localhost:3000')
      .send({ email: 'none@example.com', password: 'a-long-enough-password' })
      .expect(201);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/SameSite=None/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it('cross-site mode refuses a mutating request from an untrusted origin (CSRF)', async () => {
    const crossConfig = loadConfig({ ...ENV_BASE, COOKIE_MODE: 'cross-site' } as NodeJS.ProcessEnv);
    const crossApp = createApp(crossConfig, db).express;
    const res = await request(crossApp)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@example.com', password: 'a-long-enough-password' })
      .expect(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });
});

describe('config', () => {
  it('refuses to start in production without a real JWT secret', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('defaults to same-site cookies', () => {
    expect(loadConfig({ ...ENV_BASE } as NodeJS.ProcessEnv).cookie.mode).toBe('same-site');
  });
});
