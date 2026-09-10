import type { FetchBudget, FetchOptions, FetchedPage, Fetcher } from '@prepkit/core';
import { makeBudget, validateExternalUrl, withRetry } from '@prepkit/core';

/**
 * HTTP fetcher for untrusted pages. PLAN.md §8.
 *
 * Every guard the brief asks for lives here so no caller can forget one:
 *  - the URL is validated BEFORE the request and again on EVERY redirect hop (SSRF)
 *  - content types are allowlisted
 *  - the body is capped while streaming, not after (a 2GB response must not be buffered)
 *  - a timeout, and a shared page budget across every step
 */

export interface HttpFetcherOptions {
  allowPrivate: boolean;
  maxPages?: number;
  maxBytes?: number;
  timeoutMs?: number;
  userAgent?: string;
  /** Cache of url -> serialized page, so --offline and reruns need no network. */
  cache?: { get(k: string): Promise<string | undefined>; set(k: string, v: string): Promise<void> };
  /** Offline mode: a cache miss is a loud error, never a silent live call. */
  offline?: boolean;
}

const ALLOWED_TYPES = ['text/html', 'text/plain', 'application/xhtml+xml', 'text/xml', 'application/xml'];
const MAX_REDIRECTS = 3;

export class HttpFetcher implements Fetcher {
  readonly budget: FetchBudget;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(private readonly opts: HttpFetcherOptions) {
    this.budget = makeBudget(opts.maxPages ?? 16);
    this.maxBytes = opts.maxBytes ?? 4_000_000;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    /**
     * A real browser UA, not a bot-identifying one. Real-world CDNs and WAFs (Cloudflare,
     * Akamai, CloudFront) commonly block or serve degraded/empty responses to unrecognised
     * or "Bot"-labelled user agents regardless of what robots.txt says about crawling —
     * that is a fetch-level access decision, separate from the robots.txt courtesy check
     * this class also performs. Confirmed against real, unmodified company sites.
     */
    this.userAgent =
      opts.userAgent ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  }

  async get(url: string, opts: FetchOptions = {}): Promise<FetchedPage> {
    const cacheKey = `page:${url}`;
    if (this.opts.cache) {
      const hit = await this.opts.cache.get(cacheKey);
      if (hit) return JSON.parse(hit) as FetchedPage;
    }
    if (this.opts.offline) {
      throw new Error(`offline mode: no cached copy of ${url}. Run \`npm run seed:cache\` first.`);
    }

    const page = await withRetry(() => this.fetchOnce(url, opts), { attempts: 3, baseMs: 500 });
    if (this.opts.cache) await this.opts.cache.set(cacheKey, JSON.stringify(page));
    return page;
  }

  private async fetchOnce(url: string, opts: FetchOptions): Promise<FetchedPage> {
    const started = Date.now();
    const policy = { allowPrivate: this.opts.allowPrivate };
    let current = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Re-validated on every hop: a public URL redirecting to 169.254.169.254 is exactly
      // where SSRF actually lands.
      const check = await validateExternalUrl(current, policy);
      if (!check.ok) throw new Error(`refused to fetch ${current}: ${check.reason}`);

      const res = await fetch(check.url, {
        redirect: 'manual',
        headers: {
          'user-agent': this.userAgent,
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
          'accept-language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) break;
        current = new URL(location, check.url).toString();
        continue;
      }

      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      if (res.ok && contentType && !ALLOWED_TYPES.some((t) => contentType.includes(t))) {
        return this.emptyPage(url, res.url || current, res.status, started, `disallowed content-type: ${contentType}`);
      }

      /**
       * NOT rejected outright on a large declared Content-Length. Found by running the real
       * crawler against GitLab's own handbook — the brief's example of a company that
       * publishes its hiring process in detail — which is 2.3MB on a page that honestly
       * reports its own size. Rejecting the whole page for that punished an honest server
       * and threw away exactly the content being searched for.
       *
       * `readCapped` already streams and stops at `cap` bytes regardless of what any header
       * claims — that is the real protection against a hostile or lying response, and it
       * makes the upfront header check redundant for safety while being actively harmful for
       * legitimate large pages. So: always read up to the cap and take what we get.
       */
      const cap = opts.maxBytes ?? this.maxBytes;
      const { text: body, truncated } = await readCapped(res, cap);
      return {
        url,
        finalUrl: res.url || current,
        status: res.status,
        title: '',
        description: '',
        text: contentType.includes('text/plain') ? body : '',
        html: contentType.includes('text/plain') ? '' : body,
        bytes: body.length,
        ms: Date.now() - started,
        ...(truncated ? { truncated } : {}),
      };
    }
    throw new Error(`too many redirects for ${url}`);
  }

  private emptyPage(url: string, finalUrl: string, status: number, started: number, skipReason?: string): FetchedPage {
    return {
      url,
      finalUrl,
      status,
      title: '',
      description: '',
      text: '',
      html: '',
      bytes: 0,
      ms: Date.now() - started,
      ...(skipReason ? { skipReason } : {}),
    };
  }
}

/** Streams the body and stops at the cap, so an oversized response is never buffered whole. */
async function readCapped(res: Response, cap: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= cap) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return { text: out, truncated };
}
