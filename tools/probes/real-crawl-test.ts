/**
 * Manual diagnostic tool — hits a REAL company site, no fixtures, no mocks.
 * Used to find and verify fixes for real-world crawling behaviour (see PLAN.md / README
 * "Retrieval" section for what it found: BFS-vs-best-first search, redirect aliasing,
 * oversized-page rejection, job-posting-id false positives).
 *
 *   npx tsx --env-file=.env tools/probes/real-crawl-test.ts https://example.com
 */
import { crawlCompanySite, findHiringProcess, systemClock, consoleLogger, RateLimitedQueue, type Deps } from '@prepkit/core';
import { HttpFetcher, defaultSearch, GeminiProvider } from '@prepkit/adapters';

const deps: Deps = {
  llm: new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY ?? '', queue: new RateLimitedQueue({ concurrency: 1 }) }),
  fetcher: new HttpFetcher({ allowPrivate: false, maxPages: 16 }),
  search: defaultSearch({}),
  clock: systemClock,
  logger: consoleLogger,
  progress: { step: (e) => console.log(`  [${e.step}] ${e.status} ${e.detail ?? ''}`) },
  allowPrivateUrls: false,
};

const main = async () => {
  const url = process.argv[2] ?? 'https://stripe.com';
  console.log(`\nCrawling REAL site (no fixtures, no mocks): ${url}\n`);
  const crawl = await crawlCompanySite(url, '', deps);
  console.log(`\nRESULT:`);
  console.log(`  company name resolved: ${crawl.companyName}`);
  console.log(`  pages fetched: ${crawl.pages.length}`);
  crawl.pages.forEach((p) => console.log(`    - ${p.finalUrl} (${p.text.length} chars)`));
  console.log(`  hiring candidates found: ${crawl.hiringCandidates.length}`);
  crawl.hiringCandidates.forEach((h) => console.log(`    - [score ${h.score}] ${h.url}`));
  console.log(`  skipped: ${JSON.stringify(crawl.skipped)}`);
  console.log(`  notes: ${crawl.notes.map((n) => n.code).join(', ')}`);

  const hiring = await findHiringProcess(crawl, deps);
  console.log(`\nHiring process found: ${hiring.found}`);
  if (hiring.found) console.log(`  stages: ${hiring.stages.join(' -> ')}`);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
