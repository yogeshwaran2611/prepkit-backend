import { describe, expect, it } from 'vitest';
import type { Deps, FetchedPage, LlmRequest, LlmResult } from '../ports.js';
import { makeBudget, noopProgress, systemClock } from '../ports.js';
import { findHiringProcess } from './research.js';
import type { SiteCrawl } from './crawl.js';

/**
 * REGRESSION: found by running the real crawler against linear.app, gitlab.com and
 * stripe.com — not by reading the code. `findHiringProcess` fetches its own candidate pages
 * directly through the raw Fetcher, which only populates `.text` for a `text/plain`
 * response; for real HTML pages (i.e. every real company site) `.text` is always empty and
 * `.html` holds the markup instead. The loop was checking `page.text.length > 100` on that
 * permanently-empty string, so it silently discarded every candidate it ever fetched here —
 * regardless of what the page actually said — and every kit generated against a real company
 * site reported "no hiring page found" even when one existed and was correctly ranked #1.
 *
 * The fix runs the fetched HTML through `extractPage()`, exactly as the main crawl step
 * already does. This test fails against the old code (which reads `page.text` directly) and
 * passes against the fix.
 */

const REAL_HIRING_PAGE_HTML = `<!doctype html><html><head><title>How we hire</title></head>
<body><nav><a href="/">Home</a></nav>
<main><h1>How we hire</h1>
<p>Our interview process: an intro call, a paid take-home exercise, a system design round,
and a final conversation with the team. We aim to give a decision within a week.</p>
</main></body></html>`;

function deps(pages: Record<string, FetchedPage>, llmReply: string): Deps {
  return {
    llm: {
      name: 'fake',
      async complete(_req: LlmRequest): Promise<LlmResult> {
        return { text: llmReply, model: 'fake', provider: 'fake', usage: { prompt: 0, output: 0, total: 0 }, cached: false, ms: 0 };
      },
    },
    fetcher: {
      budget: makeBudget(16),
      async get(url: string) {
        const page = pages[url];
        if (!page) throw new Error(`unexpected fetch: ${url}`);
        return page;
      },
    },
    search: { name: 'fake', async search() { return []; } },
    clock: systemClock,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    progress: noopProgress,
    allowPrivateUrls: true,
  };
}

const emptyCrawl = (hiringUrl: string): SiteCrawl => ({
  pages: [],
  candidates: [],
  hiringCandidates: [{ url: hiringUrl, text: 'How we hire', score: 20, hiring: true }],
  skipped: [],
  robotsBlocked: [],
  companyName: 'Acme',
  notes: [],
});

describe('findHiringProcess — extracts real HTML, not just raw fetch output', () => {
  it('reads a freshly-fetched candidate page correctly when the fetcher returns raw HTML', async () => {
    const url = 'https://acme.test/how-we-hire';
    // Exactly what the REAL HttpFetcher returns for an HTML response: `.text` empty,
    // `.html` populated. This is the shape that broke the old code.
    const rawPage: FetchedPage = {
      url,
      finalUrl: url,
      status: 200,
      title: '',
      description: '',
      text: '', // <- empty, as a real fetch of an HTML page produces
      html: REAL_HIRING_PAGE_HTML,
      bytes: REAL_HIRING_PAGE_HTML.length,
      ms: 1,
    };

    const llmReply = JSON.stringify({
      found: true,
      stages: ['Intro call', 'Take-home', 'System design', 'Team conversation'],
      has_take_home: true,
      has_system_design: true,
      timeline: 'One week',
      summary: 'Intro call, take-home, system design, team conversation.',
    });

    const result = await findHiringProcess(emptyCrawl(url), deps({ [url]: rawPage }, llmReply));

    expect(result.found).toBe(true);
    expect(result.stages).toContain('Take-home');
  });

  it('does NOT report a process when the candidate page is genuinely empty', async () => {
    const url = 'https://acme.test/blank';
    const rawPage: FetchedPage = {
      url,
      finalUrl: url,
      status: 200,
      title: '',
      description: '',
      text: '',
      html: '<!doctype html><html><body></body></html>',
      bytes: 40,
      ms: 1,
    };
    const result = await findHiringProcess(emptyCrawl(url), deps({ [url]: rawPage }, '{}'));
    expect(result.found).toBe(false);
  });
});
