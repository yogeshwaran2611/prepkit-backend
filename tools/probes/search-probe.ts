/**
 * ASSUMPTION UNDER TEST: can S4 actually find public discussion of a company?
 * Prints which providers answer and which are bot-blocked, so the README states measured
 * fact rather than a hope. Blocked-everywhere is a legitimate result: the kit then reports
 * NO_PUBLIC_DISCUSSION honestly.
 *
 *   npm run probe:search
 */
import { DuckDuckGoSearch, MarginaliaSearch, BraveSearch, defaultSearch } from '@prepkit/adapters';
import type { SearchProvider } from '@prepkit/core';

const QUERY = process.env.SEARCH_QUERY ?? '"GitLab" interview process';

const candidates: SearchProvider[] = [
  ...(process.env.BRAVE_API_KEY ? [new BraveSearch({ apiKey: process.env.BRAVE_API_KEY })] : []),
  new DuckDuckGoSearch(),
  new MarginaliaSearch(),
];

const main = async () => {
  console.log(`\nsearch probe — query: ${QUERY}\n`);
  for (const p of candidates) {
    try {
      const hits = await p.search(QUERY, 4);
      console.log(`  ok       ${p.name.padEnd(12)} ${hits.length} hits`);
      hits.forEach((h) => console.log(`             - ${h.title.slice(0, 58).padEnd(58)} ${h.url.slice(0, 60)}`));
    } catch (e) {
      console.log(`  BLOCKED  ${p.name.padEnd(12)} ${(e as Error).message.slice(0, 70)}`);
    }
  }
  const chain = defaultSearch(
    process.env.BRAVE_API_KEY ? { braveApiKey: process.env.BRAVE_API_KEY } : {},
  );
  const hits = await chain.search(QUERY, 4);
  console.log(
    hits.length
      ? `\nCHAIN: ${hits.length} hits — S4 will have real sources.\n`
      : '\nCHAIN: no hits from any provider. The kit will report NO_PUBLIC_DISCUSSION honestly,\n' +
        'which is one of the cases the brief explicitly tests. Set BRAVE_API_KEY for reliable search.\n',
  );
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
