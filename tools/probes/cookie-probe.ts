/**
 * ASSUMPTION UNDER TEST (PLAN.md §8):
 *   "The session cookie survives a real cross-origin browser request in deployment."
 * A SameSite=Lax cookie is silently NOT sent cross-site, so local dev passes and
 * production is permanently logged out. This probe reproduces what a browser does:
 * register/login against the API from the web app's Origin, then reuse the cookie.
 *
 *   API=https://api.example.com WEB_ORIGIN=https://app.example.com npm run probe:cookie
 */
const API = process.env.API ?? 'http://localhost:4000';
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const EMAIL = process.env.PROBE_EMAIL ?? `probe+${Date.now()}@example.com`;
const PASSWORD = process.env.PROBE_PASSWORD ?? 'probe-password-123';

const fail: string[] = [];
const warn: string[] = [];
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => {
  console.log(`  ✗ ${m}`);
  fail.push(m);
};

const sameSiteOf = (c: string) => /samesite=([^;]+)/i.exec(c)?.[1]?.toLowerCase();
const isCrossSite = () => {
  try {
    const site = (h: string) => h.split('.').slice(-2).join('.');
    return site(new URL(API).hostname) !== site(new URL(ORIGIN).hostname);
  } catch {
    return false;
  }
};

const main = async () => {
  console.log(`\ncookie probe\n  API    ${API}\n  Origin ${ORIGIN}\n  cross-site: ${isCrossSite()}\n`);

  // 1. preflight — CORS must allow credentials with an explicit origin echo
  const pre = await fetch(`${API}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  const acao = pre.headers.get('access-control-allow-origin');
  const acac = pre.headers.get('access-control-allow-credentials');
  if (acao === ORIGIN) ok(`preflight echoes the exact Origin (${acao})`);
  else if (acao === '*') bad('Access-Control-Allow-Origin is "*" — illegal with credentials, cookie will be dropped');
  else bad(`preflight Allow-Origin is "${acao ?? 'absent'}", expected ${ORIGIN}`);
  if (acac === 'true') ok('preflight allows credentials');
  else bad('Access-Control-Allow-Credentials is not "true" — the browser will not store the cookie');

  // 2. register (409/400 is fine — the account may exist)
  const reg = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  console.log(`  · register → ${reg.status}`);

  // 3. login and inspect the Set-Cookie flags the browser would actually enforce
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) bad(`login → HTTP ${login.status} ${(await login.text()).slice(0, 160)}`);
  const setCookie = login.headers.getSetCookie?.() ?? [];
  if (!setCookie.length) bad('login sent no Set-Cookie header');
  for (const c of setCookie) {
    const name = c.split('=')[0];
    const ss = sameSiteOf(c);
    const secure = /;\s*secure/i.test(c);
    const httpOnly = /;\s*httponly/i.test(c);
    console.log(`  · Set-Cookie ${name}: SameSite=${ss ?? 'absent'} Secure=${secure} HttpOnly=${httpOnly}`);
    if (!httpOnly) bad(`${name} is not HttpOnly`);
    if (isCrossSite()) {
      if (ss === 'none' && secure) ok(`${name} is SameSite=None; Secure — correct for a cross-site deployment`);
      else bad(`${name} has SameSite=${ss ?? 'absent'} on a CROSS-SITE deployment — the browser will not send it. Set SameSite=None; Secure, or serve both under one apex domain.`);
    } else {
      if (ss === 'lax' || ss === 'strict') ok(`${name} is SameSite=${ss} — correct for a same-site deployment`);
      else warn.push(`${name} uses SameSite=${ss ?? 'absent'} on a same-site deployment (works, but Lax is tighter)`);
      if (!secure && API.startsWith('https')) bad(`${name} is not Secure on an https API`);
    }
  }

  // 4. the real test: reuse the cookie on a protected route, as a browser would
  const jar = setCookie.map((c) => c.split(';')[0]).join('; ');
  const me = await fetch(`${API}/api/auth/me`, { headers: { Origin: ORIGIN, Cookie: jar } });
  if (me.ok) ok('GET /api/auth/me with the cookie → 200 (session round-trips)');
  else bad(`GET /api/auth/me with the cookie → ${me.status} (session does not round-trip)`);

  // 5. an origin outside the allowlist must NOT be echoed
  const evil = await fetch(`${API}/api/auth/login`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  const evilAcao = evil.headers.get('access-control-allow-origin');
  if (evilAcao === 'https://evil.example') bad('CORS echoes ANY origin — the allowlist is not enforced');
  else ok('an origin outside the allowlist is not echoed');

  warn.forEach((w) => console.log(`  ! ${w}`));
  console.log(fail.length === 0 ? '\nPASS — auth works from the deployed frontend origin.\n' : `\nFAIL — ${fail.length} problem(s) above.\n`);
  process.exit(fail.length === 0 ? 0 : 1);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
