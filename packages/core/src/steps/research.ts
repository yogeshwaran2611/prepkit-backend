import { z } from 'zod';
import type { KitNote } from '@prepkit/schema';
import type { Deps, FetchedPage, SearchHit } from '../ports.js';
import { note } from '../notes.js';
import { briefPrompt, briefSchema, hiringPrompt, hiringSchema } from '../prompts/index.js';
import { parseJson } from '../resilience/json.js';
import { clampText } from '../security/sanitize.js';
import { isSameSite, validateExternalUrl } from '../security/url.js';
import type { SiteCrawl } from './crawl.js';

/** S3, S4, S5 — PLAN.md §4.3. Each degrades to an honest empty result plus a note. */

export const HIRING_PAGE_RESERVATION = 3;
export const SEARCH_PAGE_RESERVATION = 3;

// ---------------------------------------------------------------------------
// S3 — findHiringProcess. `found: false` is a first-class answer, not an error.
// ---------------------------------------------------------------------------

export interface HiringProcess {
  found: boolean;
  stages: string[];
  hasTakeHome: boolean;
  hasSystemDesign: boolean;
  timeline: string;
  summary: string;
  sources: string[];
  notes: KitNote[];
}

const RawHiring = z.object({
  found: z.boolean(),
  stages: z.array(z.string()).optional(),
  has_take_home: z.boolean().optional(),
  has_system_design: z.boolean().optional(),
  timeline: z.string().optional(),
  summary: z.string().optional(),
});

export const noHiringProcess = (): HiringProcess => ({
  found: false,
  stages: [],
  hasTakeHome: false,
  hasSystemDesign: false,
  timeline: '',
  summary: '',
  sources: [],
  notes: [note('NO_HIRING_PAGE')],
});

export async function findHiringProcess(crawl: SiteCrawl, deps: Deps): Promise<HiringProcess> {
  const started = Date.now();
  deps.progress.step({ step: 'hiring', status: 'start', at: deps.clock.now().toISOString() });

  // Pages already fetched may themselves describe the process (a careers page often does).
  const already = crawl.pages.filter((p) => looksLikeProcess(p)).slice(0, 2);
  const extra: FetchedPage[] = [];
  const reservation = Math.min(HIRING_PAGE_RESERVATION, deps.fetcher.budget.remaining());

  for (const cand of crawl.hiringCandidates.slice(0, reservation)) {
    if (!deps.fetcher.budget.take()) break;
    try {
      const page = await deps.fetcher.get(cand.url);
      if (page.status < 400 && page.text.length > 100) extra.push(page);
    } catch {
      // A single unreachable candidate is not a failure; try the next one.
    }
  }

  const pages = [...already, ...extra];
  if (!pages.length) {
    deps.progress.step({
      step: 'hiring',
      status: 'skipped',
      detail: 'no hiring or interview-process page found',
      elapsedMs: Date.now() - started,
      at: deps.clock.now().toISOString(),
    });
    return noHiringProcess();
  }

  const res = await deps.llm.complete({
    system: hiringPrompt.system,
    user: hiringPrompt.build(pages.map((p) => ({ url: p.finalUrl, text: clampText(p.text, 6_000) }))),
    responseSchema: hiringSchema,
    temperature: 0.1,
  });
  const parsed = parseJson(res.text, RawHiring);
  if (!parsed.ok || !parsed.value.found) {
    deps.progress.step({
      step: 'hiring',
      status: 'skipped',
      detail: parsed.ok ? 'pages found but none describe a process' : 'unreadable model reply',
      elapsedMs: Date.now() - started,
      at: deps.clock.now().toISOString(),
    });
    return noHiringProcess();
  }

  const v = parsed.value;
  deps.progress.step({
    step: 'hiring',
    status: 'ok',
    detail: `${(v.stages ?? []).length} stages${v.has_take_home ? ', take-home' : ''}${v.has_system_design ? ', system design' : ''}`,
    elapsedMs: Date.now() - started,
    at: deps.clock.now().toISOString(),
  });
  return {
    found: true,
    stages: (v.stages ?? []).slice(0, 12).map((s) => clampText(s, 160)),
    hasTakeHome: v.has_take_home === true,
    hasSystemDesign: v.has_system_design === true,
    timeline: clampText(v.timeline ?? '', 120),
    summary: clampText(v.summary ?? '', 1_200),
    sources: pages.map((p) => p.finalUrl),
    notes: [],
  };
}

function looksLikeProcess(p: FetchedPage): boolean {
  const hay = `${p.finalUrl} ${p.title} ${p.text.slice(0, 3_000)}`.toLowerCase();
  return /interview\s*(process|stages|loop)|how\s*we\s*hire|hiring\s*process|what\s*to\s*expect|our\s*process/.test(hay);
}

// ---------------------------------------------------------------------------
// S4 — searchPublicDiscussion. Runs even when the crawl found nothing.
// ---------------------------------------------------------------------------

export interface PublicSignal {
  hits: SearchHit[];
  pages: FetchedPage[];
  notes: KitNote[];
}

export async function searchPublicDiscussion(
  company: string,
  role: string,
  deps: Deps,
): Promise<PublicSignal> {
  const started = Date.now();
  deps.progress.step({ step: 'search', status: 'start', at: deps.clock.now().toISOString() });

  if (!company || company === 'Unknown company') {
    deps.progress.step({ step: 'search', status: 'skipped', detail: 'no company name to search for', at: deps.clock.now().toISOString() });
    return { hits: [], pages: [], notes: [note('NO_PUBLIC_DISCUSSION')] };
  }

  const queries = [
    `"${company}" interview process`,
    role ? `"${company}" ${role} interview questions` : `"${company}" engineering hiring`,
  ];

  const hits: SearchHit[] = [];
  for (const q of queries) {
    try {
      hits.push(...(await deps.search.search(q, 6)));
    } catch (e) {
      deps.logger.warn('search failed', { query: q, error: String(e) });
    }
  }

  // Dedupe by host so one noisy aggregator cannot fill the whole budget.
  const perHost = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const host = hostOf(h.url);
    if (!host) continue;
    const list = perHost.get(host) ?? [];
    if (list.length < 2) list.push(h);
    perHost.set(host, list);
  }
  const chosen = [...perHost.values()].flat().slice(0, 6);

  const pages: FetchedPage[] = [];
  const reservation = Math.min(SEARCH_PAGE_RESERVATION, deps.fetcher.budget.remaining());
  for (const hit of chosen) {
    if (pages.length >= reservation) break;
    const check = await validateExternalUrl(hit.url, { allowPrivate: deps.allowPrivateUrls });
    if (!check.ok) continue;
    if (!deps.fetcher.budget.take()) break;
    try {
      const page = await deps.fetcher.get(hit.url);
      if (page.status < 400 && page.text.length > 200) pages.push(page);
    } catch {
      // Public pages fail often; skip and report rather than abort.
    }
  }

  const notes: KitNote[] = [];
  if (!hits.length && !pages.length) notes.push(note('NO_PUBLIC_DISCUSSION'));

  deps.progress.step({
    step: 'search',
    status: hits.length ? 'ok' : 'skipped',
    detail: `${hits.length} results, ${pages.length} pages read`,
    elapsedMs: Date.now() - started,
    at: deps.clock.now().toISOString(),
  });
  return { hits: chosen, pages, notes };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// S5 — buildCompanyBrief. Grounding is enforced in code, not requested in a prompt.
// ---------------------------------------------------------------------------

export interface CompanyBrief {
  summary: string;
  what_they_do: string;
  sources: string[];
  hiring_process?: string;
  confidence: 'none' | 'low' | 'medium' | 'high';
  notes: KitNote[];
}

const RawBrief = z.object({
  summary: z.string().optional(),
  what_they_do: z.string().optional(),
  sources: z.array(z.string()).optional(),
  grounded: z.boolean().optional(),
});

const NO_EVIDENCE =
  'We could not find enough public information about this company to write an honest brief. ' +
  'Nothing here is guessed — research the company directly before the interview, and ask them ' +
  'about their product and process.';

export async function buildCompanyBrief(
  company: string,
  crawl: SiteCrawl,
  hiring: HiringProcess,
  signal: PublicSignal,
  deps: Deps,
): Promise<CompanyBrief> {
  const started = Date.now();
  deps.progress.step({ step: 'brief', status: 'start', at: deps.clock.now().toISOString() });

  const sourcePages = [...crawl.pages, ...signal.pages].filter((p) => p.text.length > 150);
  const allowed = new Set(sourcePages.map((p) => p.finalUrl));

  if (!sourcePages.length) {
    deps.progress.step({
      step: 'brief',
      status: 'skipped',
      detail: 'no readable pages, brief left honest and empty',
      elapsedMs: Date.now() - started,
      at: deps.clock.now().toISOString(),
    });
    return {
      summary: NO_EVIDENCE,
      what_they_do: '',
      sources: [],
      confidence: 'none',
      notes: [],
      ...(hiring.found ? { hiring_process: hiring.summary } : {}),
    };
  }

  const res = await deps.llm.complete({
    system: briefPrompt.system,
    user: briefPrompt.build(
      company,
      sourcePages.slice(0, 5).map((p) => ({ url: p.finalUrl, text: clampText(p.text, 4_000) })),
    ),
    responseSchema: briefSchema,
    temperature: 0.2,
  });
  const parsed = parseJson(res.text, RawBrief);

  if (!parsed.ok || parsed.value.grounded !== true || !(parsed.value.what_they_do ?? '').trim()) {
    deps.progress.step({
      step: 'brief',
      status: 'skipped',
      detail: 'model could not ground a brief in the fetched pages',
      elapsedMs: Date.now() - started,
      at: deps.clock.now().toISOString(),
    });
    return {
      summary: NO_EVIDENCE,
      what_they_do: '',
      sources: [],
      confidence: 'none',
      notes: [],
      ...(hiring.found ? { hiring_process: hiring.summary } : {}),
    };
  }

  // Grounding enforced in code: a URL the crawl never fetched cannot appear as a source.
  const sources = (parsed.value.sources ?? []).filter((s) => allowed.has(s));
  const fallbackSources = sources.length ? sources : sourcePages.slice(0, 3).map((p) => p.finalUrl);
  const evidence = fallbackSources.length + (hiring.found ? 2 : 0) + (signal.pages.length ? 1 : 0);
  const confidence = evidence >= 5 ? 'high' : evidence >= 3 ? 'medium' : 'low';

  deps.progress.step({
    step: 'brief',
    status: 'ok',
    detail: `${fallbackSources.length} sources, confidence ${confidence}`,
    elapsedMs: Date.now() - started,
    at: deps.clock.now().toISOString(),
  });

  return {
    summary: clampText(parsed.value.summary ?? '', 1_600),
    what_they_do: clampText(parsed.value.what_they_do ?? '', 400),
    sources: fallbackSources,
    confidence,
    notes: [],
    ...(hiring.found ? { hiring_process: hiring.summary } : {}),
  };
}

export function sameSiteSources(urls: string[], root: string): string[] {
  return urls.filter((u) => isSameSite(u, root));
}
