import * as cheerio from 'cheerio';
import type { SearchHit, SearchProvider } from '../pipeline/index.js';
import { withRetry } from '../pipeline/index.js';

/**
 * Public-discussion search (S4). PLAN.md §1.
 *
 * MEASURED REALITY, 2026-09-09, from this machine:
 *   html.duckduckgo.com   202 + bot-detection "anomaly" page  (blocked)
 *   www.mojeek.com        200 but <title>Captcha</title>       (blocked)
 *   searx.be              200, no usable results
 *   marginalia            200, real external links             (works, keyless)
 *   Brave Search API      works with a free key
 *
 * Keyless web search from a datacenter IP is mostly blocked, and that is a fact about the
 * internet rather than a bug to hide. So: a CHAIN of providers behind one port, tried in
 * order of quality, and when every one fails the step reports NO_PUBLIC_DISCUSSION — which
 * the brief lists as an expected case ("public discussion of the company turns up nothing
 * at all"). Nothing is ever invented to fill the gap.
 */

export interface SearchCacheLike {
  get(k: string): Promise<string | undefined>;
  set(k: string, v: string): Promise<void>;
}

interface BaseOptions {
  timeoutMs?: number;
  cache?: SearchCacheLike;
  offline?: boolean;
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** Brave Search API — best quality, needs a free key. Used first when BRAVE_API_KEY is set. */
export class BraveSearch implements SearchProvider {
  readonly name = 'brave';
  constructor(private readonly opts: BaseOptions & { apiKey: string }) {}

  async search(query: string, limit = 6): Promise<SearchHit[]> {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
      {
        headers: { accept: 'application/json', 'x-subscription-token': this.opts.apiKey },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      },
    );
    if (!res.ok) throw Object.assign(new Error(`brave HTTP ${res.status}`), { status: res.status });
    const json = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (json.web?.results ?? [])
      .filter((r) => r.url)
      .slice(0, limit)
      .map((r) => ({ title: r.title ?? '', url: r.url!, snippet: (r.description ?? '').replace(/<[^>]+>/g, '').slice(0, 400) }));
  }
}

/** DuckDuckGo HTML endpoint. Keyless; frequently bot-blocked from datacenter IPs. */
export class DuckDuckGoSearch implements SearchProvider {
  readonly name = 'duckduckgo';
  constructor(private readonly opts: BaseOptions = {}) {}

  async search(query: string, limit = 6): Promise<SearchHit[]> {
    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': BROWSER_UA },
      body: new URLSearchParams({ q: query }).toString(),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    const html = await res.text();
    // A 202 with an "anomaly" page is bot detection, not an empty result set. Treat it as a
    // provider failure so the chain moves on instead of reporting a false "nothing found".
    if (res.status === 202 || html.includes('anomaly')) {
      throw Object.assign(new Error('duckduckgo served bot detection'), { status: 429 });
    }
    if (!res.ok) throw Object.assign(new Error(`duckduckgo HTTP ${res.status}`), { status: res.status });

    const $ = cheerio.load(html);
    const hits: SearchHit[] = [];
    $('.result__body, .web-result').each((_, el) => {
      if (hits.length >= limit) return;
      const $el = $(el);
      const a = $el.find('a.result__a').first();
      const url = unwrapDdgRedirect(a.attr('href') ?? '');
      if (!url) return;
      hits.push({
        title: a.text().trim(),
        url,
        snippet: $el.find('.result__snippet').text().replace(/\s+/g, ' ').trim().slice(0, 400),
      });
    });
    if (!hits.length) throw Object.assign(new Error('duckduckgo returned no parseable results'), { status: 502 });
    return hits;
  }
}

/** Marginalia — small independent index, keyless, and actually reachable. */
export class MarginaliaSearch implements SearchProvider {
  readonly name = 'marginalia';
  constructor(private readonly opts: BaseOptions = {}) {}

  async search(query: string, limit = 6): Promise<SearchHit[]> {
    const res = await fetch(`https://old-search.marginalia.nu/search?query=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': BROWSER_UA },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 12_000),
    });
    if (!res.ok) throw Object.assign(new Error(`marginalia HTTP ${res.status}`), { status: res.status });

    const $ = cheerio.load(await res.text());
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    $('a[href^="http"]').each((_, el) => {
      if (hits.length >= limit) return;
      const $el = $(el);
      const href = $el.attr('href') ?? '';
      if (!href || /marginalia|memex\.marginalia/.test(href)) return;
      const url = href.split('#')[0]!;
      if (seen.has(url)) return;
      const title = $el.text().replace(/\s+/g, ' ').trim();
      if (title.length < 8) return;
      seen.add(url);
      hits.push({ title: title.slice(0, 200), url, snippet: '' });
    });
    if (!hits.length) throw Object.assign(new Error('marginalia returned no results'), { status: 502 });
    return hits;
  }
}

/**
 * Tries each provider in order and returns the first that answers. Caches by query, so the
 * committed cache makes `--offline` work and repeat runs cost nothing.
 */
export class SearchChain implements SearchProvider {
  readonly name = 'chain';
  constructor(
    private readonly providers: SearchProvider[],
    private readonly opts: BaseOptions & { onFallback?: (from: string, error: unknown) => void } = {},
  ) {}

  async search(query: string, limit = 6): Promise<SearchHit[]> {
    const key = `search:${query}`;
    if (this.opts.cache) {
      const hit = await this.opts.cache.get(key);
      if (hit) return (JSON.parse(hit) as SearchHit[]).slice(0, limit);
    }
    if (this.opts.offline) return [];

    for (const provider of this.providers) {
      try {
        const hits = await withRetry(() => provider.search(query, limit), { attempts: 2, baseMs: 700 });
        if (hits.length) {
          if (this.opts.cache) await this.opts.cache.set(key, JSON.stringify(hits));
          return hits;
        }
      } catch (e) {
        this.opts.onFallback?.(provider.name, e);
      }
    }
    // Every provider blocked or empty. An honest empty result, never a fabricated one.
    return [];
  }
}

/** Builds the default chain from the environment. */
export function defaultSearch(opts: BaseOptions & { braveApiKey?: string; onFallback?: (from: string, error: unknown) => void } = {}): SearchProvider {
  const providers: SearchProvider[] = [];
  if (opts.braveApiKey) providers.push(new BraveSearch({ ...opts, apiKey: opts.braveApiKey }));
  providers.push(new DuckDuckGoSearch(opts), new MarginaliaSearch(opts));
  return new SearchChain(providers, opts);
}

/** DDG wraps results in /l/?uddg=<encoded>. */
function unwrapDdgRedirect(href: string): string {
  if (!href) return '';
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const raw = u.searchParams.get('uddg') ?? href;
    const parsed = new URL(raw, 'https://duckduckgo.com');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

/** Used by --offline and by tests: no network, no surprises. */
export class NullSearch implements SearchProvider {
  readonly name = 'none';
  async search(): Promise<SearchHit[]> {
    return [];
  }
}
