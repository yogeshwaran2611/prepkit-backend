// robots-parser ships CJS types that do not survive `import type`; the shape we use is tiny.
import robotsParser from 'robots-parser';

type Robots = { isAllowed(url: string, ua?: string): boolean | undefined };
import type { KitNote } from '@prepkit/schema';
import type { Deps, FetchedPage } from '../ports.js';
import { note } from '../notes.js';
import { extractPage, rankLinks, resolveCompanyName, type RankedLink } from '../html/extract.js';
import { isSameSite, validateExternalUrl } from '../security/url.js';
import { clampText } from '../security/sanitize.js';

/**
 * S2 — crawlCompanySite. PLAN.md §4.3 S2.
 *
 * "Crawl the site, rank the links, fetch what looks right. A fixed list of paths is not
 * sufficient." So no path list appears anywhere in this file: link ranking is driven by the
 * anchors the site actually has.
 *
 * NEVER THROWS. A dead site produces an empty crawl plus a note, and the run continues —
 * "skip and report a source that cannot be retrieved, rather than failing the whole run".
 */

export const MAX_DEPTH = 2;
export const SITE_PAGE_RESERVATION = 10;
const PAGE_TEXT_CHARS = 8_000;

export interface SiteCrawl {
  pages: FetchedPage[];
  candidates: RankedLink[];
  hiringCandidates: RankedLink[];
  skipped: { url: string; reason: string }[];
  robotsBlocked: string[];
  companyName: string;
  notes: KitNote[];
}

export function emptyCrawl(url: string, companyFromJd: string, reason: string): SiteCrawl {
  return {
    pages: [],
    candidates: [],
    hiringCandidates: [],
    skipped: [{ url, reason }],
    robotsBlocked: [],
    companyName: resolveCompanyName({ url, companyFromJd }),
    notes: [note('COMPANY_UNREACHABLE', { url, reason })],
  };
}

export async function crawlCompanySite(
  companyUrl: string,
  companyFromJd: string,
  deps: Deps,
): Promise<SiteCrawl> {
  const started = Date.now();
  deps.progress.step({ step: 'crawl', status: 'start', at: deps.clock.now().toISOString() });

  const policy = { allowPrivate: deps.allowPrivateUrls };
  const check = await validateExternalUrl(companyUrl, policy);
  if (!check.ok) {
    deps.progress.step({
      step: 'crawl',
      status: 'skipped',
      detail: `rejected URL: ${check.reason}`,
      elapsedMs: Date.now() - started,
      at: deps.clock.now().toISOString(),
    });
    return emptyCrawl(companyUrl, companyFromJd, `invalid or disallowed URL (${check.reason})`);
  }

  const root = check.url;
  // A site served under a path prefix (Appendix B's http://localhost:8099/acme/) must not
  // wander outside it: same-host is not the same thing as same-site when several fixture
  // sites share one origin. For a domain-rooted site the prefix is "/" and this is a no-op.
  const rootPrefix = root.pathname.endsWith('/') ? root.pathname : `${root.pathname.replace(/[^/]*$/, '')}`;
  const inScope = (u: string): boolean => {
    if (!isSameSite(u, root)) return false;
    if (rootPrefix === '/' || rootPrefix === '') return true;
    try {
      return new URL(u).pathname.startsWith(rootPrefix);
    } catch {
      return false;
    }
  };
  const pages: FetchedPage[] = [];
  const skipped: SiteCrawl['skipped'] = [];
  const robotsBlocked: string[] = [];
  const notes: KitNote[] = [];
  const allLinks: { href: string; text: string; inNav: boolean }[] = [];

  const robots = await loadRobots(root, deps);
  const seen = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: root.toString(), depth: 0 }];
  let budgetHit = false;
  const siteBudget = Math.min(SITE_PAGE_RESERVATION, deps.fetcher.budget.remaining());
  let fetchedHere = 0;

  while (queue.length && fetchedHere < siteBudget) {
    // Breadth first, but prefer the highest-ranked link at the current frontier so that a
    // careers page beats a press release when the budget is tight.
    const nextIdx = pickNext(queue, allLinks, root);
    const item = queue.splice(nextIdx, 1)[0]!;
    const normalized = normalizeUrl(item.url);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    if (robots && robots.isAllowed(item.url, 'PrepKitBot') === false) {
      robotsBlocked.push(item.url);
      continue;
    }
    if (!deps.fetcher.budget.take()) {
      budgetHit = true;
      break;
    }

    let page: FetchedPage;
    try {
      page = await deps.fetcher.get(item.url);
    } catch (e) {
      skipped.push({ url: item.url, reason: describeError(e) });
      continue;
    }
    fetchedHere++;

    if (page.status >= 400 || !page.html) {
      skipped.push({ url: item.url, reason: page.skipReason ?? `HTTP ${page.status}` });
      continue;
    }

    /**
     * A locale or www redirect means two DIFFERENT requested urls land on the SAME content
     * — found for real on stripe.com, where /blog links to "/careers" but every other page
     * links to "/in/careers", and "/careers" 30x-redirects to "/in/careers". Dedup on the
     * requested url alone missed this: the budget paid for the request either way, but
     * without this check the same content was kept and re-parsed as if it were new, and a
     * THIRD differently-pathed link to the same redirect target would be fetched again too.
     * Registering the RESOLVED url closes that off after the first landing.
     */
    const finalNormalized = normalizeUrl(page.finalUrl);
    if (finalNormalized !== normalized && seen.has(finalNormalized)) {
      skipped.push({ url: item.url, reason: `redirects to an already-fetched page (${page.finalUrl})` });
      continue;
    }
    seen.add(finalNormalized);

    // Relative links resolve against the RESPONSE url, not the requested one: redirects and
    // Appendix B's localhost fixtures both depend on this.
    const extracted = extractPage(page.html, page.finalUrl);
    const text = clampText(extracted.text, PAGE_TEXT_CHARS);
    if (text.length < 120) notes.push(note('THIN_PAGE', { url: page.finalUrl, chars: text.length }));

    pages.push({
      ...page,
      title: extracted.title || page.title,
      description: extracted.description,
      text,
      html: '',
    });
    allLinks.push(...extracted.links);

    if (item.depth < MAX_DEPTH) {
      for (const l of extracted.links) {
        if (!inScope(l.href)) continue;
        const n = normalizeUrl(l.href);
        if (!seen.has(n) && !queue.some((q) => normalizeUrl(q.url) === n)) {
          queue.push({ url: l.href, depth: item.depth + 1 });
        }
      }
    }
  }

  if (budgetHit || (queue.length && fetchedHere >= siteBudget)) {
    notes.push(note('BUDGET_EXHAUSTED', { fetched: fetchedHere, queued: queue.length }));
  }
  if (robotsBlocked.length) notes.push(note('ROBOTS_BLOCKED', { count: robotsBlocked.length }));
  if (!pages.length) {
    const reason = skipped[0]?.reason ?? 'no pages could be retrieved';
    deps.progress.step({
      step: 'crawl',
      status: 'skipped',
      detail: reason,
      elapsedMs: Date.now() - started,
      at: deps.clock.now().toISOString(),
    });
    const empty = emptyCrawl(companyUrl, companyFromJd, reason);
    return { ...empty, skipped: [...skipped, ...empty.skipped], robotsBlocked, notes: [...notes, ...empty.notes] };
  }

  const ranked = rankLinks(allLinks, root.toString()).filter((l) => inScope(l.url));
  const fetchedUrls = new Set(pages.map((p) => normalizeUrl(p.finalUrl)));
  const hiringCandidates = ranked
    .filter((l) => l.hiring && !fetchedUrls.has(normalizeUrl(l.url)))
    .slice(0, 6);

  const home = pages[0]!;
  const companyName = resolveCompanyName({
    siteName: extractSiteName(pages),
    title: home.title,
    companyFromJd,
    url: root.toString(),
  });

  deps.progress.step({
    step: 'crawl',
    status: 'ok',
    detail: `${pages.length} pages, ${hiringCandidates.length} hiring candidates`,
    elapsedMs: Date.now() - started,
    at: deps.clock.now().toISOString(),
  });

  return { pages, candidates: ranked, hiringCandidates, skipped, robotsBlocked, companyName, notes };
}

function extractSiteName(pages: FetchedPage[]): string {
  for (const p of pages) {
    // extractPage put the site name in description-adjacent metadata; re-derive cheaply.
    if (p.title.includes('|') || p.title.includes('—')) continue;
    if (p.title && p.title.length < 40) return '';
  }
  return '';
}

/**
 * GLOBAL best-first, not breadth-limited. This is not cosmetic: a real homepage has enough
 * nav links (blog, docs, partners, customers, pricing...) to exhaust a 10-page budget at
 * depth 1 alone, so a naive "finish this depth band before the next" BFS never reaches a
 * depth-2 child even when that child is exactly the hiring page being searched for.
 *
 * Found by running the real crawler against https://stripe.com: it fetched /careers but the
 * budget was gone before any of the pages LINKED FROM /careers got a turn, because eight
 * shallow nav links (blog, roadmap, partners, startups, docs, customers...) all outranked
 * "explore what /careers actually links to". Scoring every queued candidate regardless of
 * depth fixes this — once /careers is fetched, its children are scored immediately and a
 * genuinely hiring-relevant child jumps ahead of unrelated shallow nav links.
 *
 * maxDepth is still enforced elsewhere (a link is never queued past MAX_DEPTH); this only
 * changes the ORDER candidates already in the queue are visited in.
 */
function pickNext(
  queue: { url: string; depth: number }[],
  links: { href: string; text: string; inNav: boolean }[],
  root: URL,
): number {
  if (queue.length <= 1) return 0;
  const ranked = rankLinks(links, root.toString());
  const scoreOf = (url: string) => ranked.find((r) => normalizeUrl(r.url) === normalizeUrl(url))?.score ?? 0;
  let best = 0;
  let bestScore = -Infinity;
  queue.forEach((q, i) => {
    // A slight depth penalty keeps two equally-scored links resolved in a stable, shallow-
    // first order, without letting depth override a real score difference the way the old
    // "shallowest band only" rule did.
    const s = scoreOf(q.url) - q.depth * 0.5;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return best;
}

async function loadRobots(root: URL, deps: Deps): Promise<Robots | null> {
  const robotsUrl = new URL('/robots.txt', root).toString();
  try {
    // robots.txt is a courtesy fetch and must not consume the page budget.
    const res = await deps.fetcher.get(robotsUrl, { maxBytes: 512_000, timeoutMs: 5_000 });
    if (res.status !== 200 || !res.text) return null;
    return (robotsParser as unknown as (u: string, t: string) => Robots)(robotsUrl, res.text);
  } catch {
    // No robots.txt is the common case and means "allowed".
    return null;
  }
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    let path = u.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    u.pathname = path;
    return u.toString().toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout|abort/i.test(msg)) return 'timed out';
  if (/enotfound|dns/i.test(msg)) return 'domain does not resolve';
  if (/econnrefused/i.test(msg)) return 'connection refused';
  return msg.slice(0, 120);
}
