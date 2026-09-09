/**
 * All environment reading happens here. Nothing deeper in the app touches process.env, so
 * the deployed configuration is auditable in one file.
 */

export interface Config {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  jwtSecret: string;
  cookie: CookieConfig;
  corsOrigins: string[];
  gemini: { apiKey: string; model: string | undefined };
  braveApiKey: string | undefined;
  llm: { tpm: number; rpm: number; concurrency: number };
  allowPrivateUrls: boolean;
  fetchMaxPages: number;
  jobConcurrency: number;
  jobLeaseMs: number;
}

export interface CookieConfig {
  name: string;
  /**
   * §8 — the trap that breaks deployments. Vercel `*.vercel.app` and a `*.fly.dev` API are
   * different registrable domains, so every API call is CROSS-SITE and a SameSite=Lax
   * cookie is silently NOT sent: local dev works, production is permanently logged out.
   */
  mode: 'same-site' | 'cross-site';
  sameSite: 'lax' | 'none';
  secure: boolean;
  domain: string | undefined;
  maxAgeMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = (env.NODE_ENV as Config['nodeEnv']) ?? 'development';
  const isProd = nodeEnv === 'production';

  const jwtSecret = env.JWT_SECRET ?? '';
  if (isProd && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production.');
  }

  const mode: CookieConfig['mode'] = env.COOKIE_MODE === 'cross-site' ? 'cross-site' : 'same-site';

  return {
    port: Number(env.PORT ?? 4000),
    nodeEnv,
    jwtSecret: jwtSecret || 'dev-only-insecure-secret-do-not-use-in-production',
    cookie: {
      name: 'prepkit_session',
      mode,
      // SameSite=None REQUIRES Secure; browsers reject the pair otherwise.
      sameSite: mode === 'cross-site' ? 'none' : 'lax',
      secure: mode === 'cross-site' ? true : isProd,
      domain: env.COOKIE_DOMAIN || undefined,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    },
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    gemini: { apiKey: env.GEMINI_API_KEY ?? '', model: env.GEMINI_MODEL || undefined },
    braveApiKey: env.BRAVE_API_KEY || undefined,
    llm: {
      tpm: Number(env.LLM_TPM ?? 0),
      rpm: Number(env.LLM_RPM ?? 0),
      concurrency: Number(env.LLM_CONCURRENCY ?? 2),
    },
    allowPrivateUrls: env.ALLOW_PRIVATE_URLS === 'true',
    fetchMaxPages: Number(env.FETCH_MAX_PAGES ?? 16),
    jobConcurrency: Number(env.JOB_CONCURRENCY ?? 2),
    jobLeaseMs: Number(env.JOB_LEASE_MS ?? 5 * 60 * 1000),
  };
}

/** Logged at boot so a misconfigured deployment is obvious immediately, not at login. */
export function describeConfig(c: Config): string {
  const warnings: string[] = [];
  if (c.allowPrivateUrls && c.nodeEnv === 'production') {
    warnings.push('ALLOW_PRIVATE_URLS=true IN PRODUCTION — SSRF protection is relaxed. Unset it.');
  }
  if (!c.gemini.apiKey) warnings.push('GEMINI_API_KEY is not set — kit generation will fail.');
  if (c.cookie.mode === 'cross-site' && !c.cookie.secure) warnings.push('cross-site cookies require Secure.');
  return [
    `port=${c.port} env=${c.nodeEnv}`,
    `cookie=${c.cookie.mode} sameSite=${c.cookie.sameSite} secure=${c.cookie.secure} domain=${c.cookie.domain ?? '(host-only)'}`,
    `cors=${c.corsOrigins.join(', ')}`,
    `model=${c.gemini.model ?? 'gemini-3.1-flash-lite (default)'} tpm=${c.llm.tpm || 'unlimited'} rpm=${c.llm.rpm || 'unlimited'}`,
    `allowPrivateUrls=${c.allowPrivateUrls} fetchMaxPages=${c.fetchMaxPages}`,
    ...warnings.map((w) => `WARNING: ${w}`),
  ].join('\n  ');
}
