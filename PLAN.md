# AI Interview Prep Kit — Architecture & Build Plan

Source of truth for the Trao Full-Stack Assessment (FS-AI-INTERVIEW-01).
Written so multiple agents can build in parallel without stepping on each other.

Two things in the brief are **exact and frozen**: the kit structure (Appendix A) and
the batch entry point (`npm run evaluate -- --input <cases.json> --output <kits.json>`,
Appendix B). Everything else is a defended choice.

---

## 0. Grading scale → where effort goes

| Bucket | Pts | Owned by |
|---|---|---|
| Requirement extraction (found, marked must/nice, nothing invented) | 20 | `packages/core/extract` + prompt |
| Coverage & schedule (every must has a question, days exact, all allocated) | 15 | `packages/core/coverage`, `packages/core/schedule` — **deterministic code, no LLM** |
| Research & sequencing (crawl, hiring page, public discussion, per-category generation, real coverage loop) | 10 | `packages/core/research`, `pipeline` |
| Robustness (run completes, unreachable recorded not fatal, structure matches, tests pass) | 10 | `packages/schema`, `resilience`, `evaluate` CLI |
| Builder (edit, reorder, regenerate preserves edits) | 15 | `packages/core/merge` + `apps/web` builder |
| Interaction design (loading/empty/error, responsive, keyboard) | 10 | `apps/web` + design system |
| Code quality, separation of concerns, README reasoning | 10 | layering + README |
| Practice mode + creative feature | 10 | `apps/web/practice`, `core/srs`, weak-spots report |

Two of those 55 automated points (coverage+schedule = 15) are pure arithmetic. They
must never be delegated to the model. That is the single highest-leverage rule here.

---

## 1. Tech stack (and why)

| Layer | Choice | Why / license |
|---|---|---|
| Language | **TypeScript** strict everywhere | one type source shared front↔back, MIT |
| Frontend | **Next.js 15** App Router + React 19 | preferred stack; RSC for kit read, client islands for the builder |
| Styling | **Tailwind CSS v4** + CSS variables tokens | preferred stack |
| Components | **shadcn/ui** (Radix primitives) — copied in, not a dep | Radix gives keyboard + a11y for free (10 pts of interaction design), MIT |
| Icons | **lucide-react** (ISC) |
| Drag/reorder | **@dnd-kit/core + sortable** (MIT) | keyboard-accessible sorting out of the box; `react-beautiful-dnd` is not |
| Client state | **TanStack Query** (server cache) + **Zustand** (builder draft) | MIT |
| Backend | **Node 22 + Express 5** | preferred stack; separate deployable so "backend reachable" is literally true |
| DB | **MongoDB Atlas free tier** via **official `mongodb` driver** (no Mongoose) | Apache-2.0; schema is already enforced by Zod — Mongoose would be a second, weaker schema |
| Validation | **Zod v4** | single schema → TS types → runtime validation → JSON Schema for the LLM |
| Auth | **jose** (JWT, httpOnly cookie) + **@node-rs/argon2** | MIT; no Auth.js — we need the same session logic in Express, and email verify/reset are explicitly out of scope |
| HTTP fetch | Node `fetch` (undici) + **`p-retry`**, **`p-queue`** | MIT |
| HTML→text | **cheerio** (link ranking) + **@mozilla/readability + linkedom** (main content) | MIT/MPL-2.0 |
| robots.txt | **robots-parser** (MIT) |
| Search (public discussion) | **DuckDuckGo html endpoint** + optional **Brave Search API free tier** behind one `SearchProvider` interface | no paid key required to pass |
| LLM | **Google Gemini** `gemini-2.5-flash` primary, **Groq** `llama-3.3-70b-versatile` fallback, behind one `LlmProvider` interface | both free with **no credit card** (Gemini = AI Studio key, Groq = account only); Gemini's JSON-schema mode is stricter, Groq is faster and keeps the demo alive if Gemini's daily cap hits → §7 |
| Tests | **Vitest** + **supertest** + **msw** | MIT |
| Lint/format | ESLint 9 flat + Prettier |
| Monorepo | **npm workspaces** (no pnpm, no Turborepo) | the mandatory `npm run evaluate` must work from a clean clone — see §2 |
| Deploy | web → **Vercel** free; api → **Fly.io** free (see §15); db → **Atlas M0**; **both behind one apex domain** (`app.<domain>` → web, `api.<domain>` → api) so the session cookie is same-site |

Everything above is OSI-licensed and free-tier.

**Deviations to justify in README:** MongoDB driver over Mongoose; hand-rolled JWT auth
over Auth.js; separate Express service rather than Next route handlers (the brief asks for
a Node+Express backend and a separately reachable API, and the batch CLI needs the pipeline
importable outside Next).

---

## 2. Repository layout

```
prepkit/
├─ package.json                # npm workspaces + "evaluate" script → packages/core CLI
│                              #   "workspaces": ["apps/*","packages/*"]  (NOT pnpm — see below)
├─ package-lock.json           # committed: npm ci from a clean clone must be reproducible
├─ .env.example                # every var documented inline
├─ README.md
├─ PLAN.md                     # this file
├─ fixtures/
│  ├─ cases.example.json       # Appendix B input, 5 cases incl. thin-JD + no-hiring-page
│  └─ sites/                   # static HTML company sites served by tools/local-site-server
├─ tools/
│  └─ local-site-server.ts     # serves fixtures/sites on :8099 for offline tests + demo
├─ .cache/                     # COMMITTED fixture cache — makes `--offline` work with no key
├─ packages/
│  ├─ schema/                  # ZERO runtime deps except zod. Frozen contracts.
│  ├─ core/                    # domain + pipeline. Pure TS, no Express, no Next, no DB.
│  ├─ db/                      # Mongo connection + repositories. Depends on schema only.
│  └─ ui/                      # design tokens + primitives shared by web (optional split)
└─ apps/
   ├─ api/                     # Express: HTTP, auth, jobs runner, SSE
   └─ web/                     # Next.js
```

> **Package manager: npm, deliberately — and this is not a style preference.**
> §9's `npm run evaluate` is mandatory and graded, and the brief says it must work **from a
> clean clone**. A pnpm-workspace repo breaks exactly that: `npm install` does not read
> `pnpm-workspace.yaml`, and the `workspace:*` dependency protocol is pnpm-only, so npm
> either errors during install or leaves `packages/*` unlinked — and the CLI dies on its
> first cross-package import. A grader typing `npm install && npm run evaluate` must not see
> a stack trace. Therefore: npm workspaces (`"workspaces": ["apps/*","packages/*"]`),
> `file:`/workspace-range deps only, `package-lock.json` committed, no Turborepo (plain
> `npm run -ws` scripts are enough at this size).
> **Acceptance test, run on a real clean clone before submitting:**
> `git clone <repo> /tmp/x && cd /tmp/x && npm install && npm run evaluate -- --input fixtures/cases.example.json --output /tmp/kits.json --offline`
> This is a Phase 0 CI job, not a Day 4 hope.

**Dependency rule (enforced by ESLint `no-restricted-imports`):**
`schema` ← `core` ← `db` ← `api` ← `web`. Arrows never reverse.
`core` may not import `db`, `express`, `next`, or anything from `apps/*`.
Persistence reaches `core` only as injected function parameters.

---

## 3. Frozen contracts (`packages/schema`) — build FIRST, then nobody edits

> **Interface freeze:** Phase 0 lands `packages/schema` and `packages/core/ports.ts`.
> After that, any change to either requires updating this document in the same commit.
> Every other agent codes against these types and can work blind.

### 3.1 `kit.ts` — Appendix A, exact field names

```ts
export const RequirementKind = z.enum(['technical','behavioural','domain']);
export const RequirementPriority = z.enum(['must','nice']);
export const QuestionCategory = z.enum(['technical','behavioural','system-design','company-fit']);

export const Requirement = z.object({
  id: z.string().regex(/^r\d+$/),         // stable within kit
  text: z.string().min(1).max(400),
  kind: RequirementKind,
  priority: RequirementPriority,
  provenance: Provenance.optional(),      // our extension: jd char span, for "nothing invented"
});

export const Question = z.object({
  id: z.string().regex(/^q\d+$/),
  requirement_ids: z.array(z.string()).min(1).max(3),   // >3 = shotgun tagging (§4.3 S7)
  category: QuestionCategory,
  prompt: z.string().min(1).max(600),
  answer_outline: z.string().max(2000),   // caps exist so one verbose model reply cannot
  difficulty: z.number().int().min(1).max(3),            // bloat the doc or the UI
  meta: ItemMeta.optional(),              // extension: origin/pinned/updated_at
});

export const Flashcard = z.object({
  id: z.string().regex(/^f\d+$/),
  front: z.string().min(1).max(300), back: z.string().max(800),
  requirement_ids: z.array(z.string()).max(3),
  meta: ItemMeta.optional(),
});
// Length caps are OUR guard, not Appendix A's: a 4,000-word answer_outline is valid JSON,
// unreadable in the UI, and inflates every later prompt. Over-long model output is TRUNCATED
// at a sentence boundary (not rejected — that would fail a whole step over verbosity) and
// counted; a manual/edited item is never truncated, because the user meant it.

export const ScheduleDay = z.object({
  day: z.number().int().positive(),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: z.number().int().nonnegative(),   // integer minutes, no floats
  kind: z.enum(['new','review']).default('new'),  // extension: §4.3 S8 days=60 handling
  meta: ItemMeta.optional(),                      // extension: a user-edited day is FROZEN (§5.1)
});

// ---- extension types the rules above depend on. Defined here because §3 is frozen
// ---- FIRST and every track codes blind against it — an undefined type gets invented
// ---- four different ways.
export const Provenance = z.object({
  source_span: z.string(),        // verbatim substring of the JD; the anti-invention proof
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  heading: z.string().optional(), // the heading the span sat under → must/nice heuristic
});

export const NoteCode = z.enum([
  'THIN_JD','NO_HIRING_PAGE','NO_PUBLIC_DISCUSSION','COMPANY_UNREACHABLE',
  'ROBOTS_BLOCKED','THIN_PAGE','FALLBACK_QUESTION_USED','LINKS_REJECTED',
  'SCHEDULE_OVERLOADED','SCHEDULE_RECONCILED','PROVIDER_FAILOVER',
]);
export const KitNote = z.object({
  code: NoteCode,
  message: z.string(),            // one honest human sentence, rendered by NotesPanel
  detail: z.record(z.string(), z.unknown()).optional(),
});

export const ItemMeta = z.object({
  origin: z.enum(['generated','edited','manual']),
  pinned: z.boolean().default(false),
  updated_at: z.string(),
});
// NOTE: declaration order in the real file is ItemMeta/Provenance/KitNote FIRST,
// then Requirement/Question/Flashcard/ScheduleDay/Kit. Shown after only for readability.

export const Kit = z.object({
  source: z.object({ company: z.string(), company_url: z.string(), role: z.string(),
                     location: z.string(), jd_chars: z.number().int(),
                     researched_at: z.string(), pages_used: z.array(z.string()) }),
  company_brief: z.object({ summary: z.string(), what_they_do: z.string(),
                            sources: z.array(z.string()),
                            hiring_process: z.string().optional(),      // extension
                            confidence: z.enum(['none','low','medium','high']).optional() }),
  role: z.object({ title: z.string(), seniority: z.string(),
                   responsibilities: z.array(z.string()),
                   requirements: z.array(Requirement) }),
  questions: z.array(Question),
  flashcards: z.array(Flashcard),
  schedule: z.object({ days_available: z.number().int().positive(),
                       days: z.array(ScheduleDay) }),
  coverage: z.object({ uncovered_requirement_ids: z.array(z.string()),
                       passes: z.number().int().nonnegative() }),
  notes: z.array(KitNote).optional(),     // extension: honest gaps, machine-checkable
  order: z.object({                       // extension: user ordering is state (§5 rule 6)
    questions: z.array(z.string()).optional(),
    flashcards: z.array(z.string()).optional(),
    responsibilities: z.array(z.string()).optional(),
  }).optional(),                          // absent ⇒ render in array order
});
```

Extensions are all `.optional()` (or `.default()`ed) so a kit remains valid against a strict
reading of Appendix A. Every field Appendix A names is present, required, and named exactly.

**Because §3 is frozen first, it must already contain every field the later sections rely on.**
The dependency map, so a drift is obvious in review:
`ScheduleDay.kind` ← §4.3 S8 (`days=60` review days), §3.2 rule 3.
`ScheduleDay.meta` ← §5.1 (frozen edited days).
`Kit.order` ← §5 rule 6 (`mergeOrder`).
`Requirement.provenance` ← §4.3 S1 (span verification).
`Kit.notes` ← §4.3 S1/S2/S3/S4, S7, S8, §7 failover.
`ItemMeta` ← all of §5.
Adding a rule to §4/§5 that needs a new field means editing §3 **in the same commit**.

**One consequence worth stating:** because S7 synthesises a deterministic fallback question
for any still-uncovered must-have, `coverage.uncovered_requirement_ids` should in practice
contain only `nice` requirements. A `must` id appearing there is a bug, and
`checkKitIntegrity` rule 4 is what catches it.

### 3.2 `integrity.ts` — the referential rules the brief states

```ts
export function checkKitIntegrity(kit: Kit): IntegrityIssue[]
```
Asserts, in code, not in a prompt:
1. every `question.requirement_ids[*]` exists in `role.requirements`
2. every `schedule.days[*].question_ids[*]` exists in `questions`
3. `schedule.days.length === schedule.days_available`, days are `1..n` with no gaps, and
   **every question has exactly one first assignment** — repeats allowed only on `kind:'review'`
   days (see §4.3 S8; naive global uniqueness is the wrong rule and would fail `days=60`)
4. every `priority:'must'` requirement id appears in ≥1 question **and** ≥1 schedule day
5. all ids unique and prefix-shaped; `minutes` and `difficulty` integers in range
`validateKit(kit)` = Zod parse + integrity → used before every DB write and before every CLI emit.

### 3.3 `batch.ts` — Appendix B
`BatchCase { id, jd, company_url, days }`, `BatchOutput { version:'1.0', generated_at, kits: [{ id, status:'ok'|'failed', kit, error }] }`.
`error: { code: ErrorCode, message: string } | null`.
`ErrorCode = 'COMPANY_UNREACHABLE'|'LLM_UNAVAILABLE'|'INVALID_INPUT'|'EXTRACTION_EMPTY'`
`|'CASE_TIMEOUT'|'INTERNAL'`.
`CASE_TIMEOUT` exists because §9 imposes a 150 s per-case budget; a case that blows it must
report an honest code rather than being mislabelled `INTERNAL`. Note the split that matters
for grading: `COMPANY_UNREACHABLE` is a `failed` case only when the site was the *sole*
input — a reachable site with no hiring page is `ok` plus a `NO_HIRING_PAGE` note, never a
failure (§9, and the brief's FAQ says so explicitly).

### 3.4 `api.ts` — every request/response body as a Zod schema
Web imports these; there is no second definition of any wire type.

---

## 4. Pipeline design (`packages/core`)

### 4.1 Ports (dependency inversion — the only place I/O is abstracted)

```ts
// packages/core/ports.ts
export interface LlmProvider {
  readonly name: string;
  complete(req: { system: string; user: string; maxTokens?: number;
                  temperature?: number; jsonSchema?: unknown }): Promise<LlmResult>;
}
export interface Fetcher { get(url: string, o?: {maxBytes?:number; timeoutMs?:number}): Promise<FetchedPage> }
export interface SearchProvider { search(q: string, n?: number): Promise<SearchHit[]> }
export interface Clock { now(): Date }
export interface Logger { info/warn/error(msg: string, meta?: object): void }
export interface ProgressSink { step(e: StepEvent): void }   // powers SSE and CLI logs
export type Deps = { llm; fetcher; search; clock; logger; progress; rng };
```
Tests inject fakes; nothing in `core` reads `process.env`.

### 4.2 The eight steps — genuinely sequenced, each responds to the last

```
        pasted JD (no retrieval needed)
              │
  S1 extractRequirements ──────────────────────────► requirements[] (must/nice, kind, spans)
              │
  S2 crawlCompanySite  (needs network)             ► ranked pages, hiringPage?
              │            ▲ rank links from THIS site's actual anchors
  S3 findHiringProcess (only if S2 found a candidate)
              │
  S4 searchPublicDiscussion (query built from company + role + S3 findings)
              │
  S5 buildCompanyBrief (grounded ONLY in S2/S3/S4 text; else honest "not found")
              │
  S6 generateQuestions — ONE CALL PER CATEGORY, each call sees only
              │           the requirements relevant to it + the hiring-process facts
  S7 coverageLoop  ── deterministic diff ──► gaps ──► targeted S6 for gaps ──► re-diff
              │        (max 3 passes, stop when no must-gaps)
  S8 allocateSchedule — pure arithmetic, no LLM
              │
        validateKit → persist / emit
```

Why this shape (README material): pasted text needs no retrieval, so S1 runs before any
network call and its output shapes every later query. A homepage is useless until crawled,
so S2 must precede S3/S5. A discovered hiring process changes which questions make sense,
so S3 feeds S6. And "5 years React while mentoring juniors" must not produce technical and
behavioural questions from one call with one instruction — hence one call per category.

### 4.3 Step-by-step function contracts

Every step is `(input, deps) => Promise<Output>`, pure w.r.t. its input, and emits
`deps.progress.step()` at start/finish. All are individually unit-testable.

**S1 `extractRoleFromJd(jd: string, deps): Promise<RoleExtraction>`**
- `packages/core/steps/extract.ts`
- **Owns every Appendix-A field derivable from the JD — not just requirements.** Named
  explicitly because these are *required* fields and a parallel build will otherwise leave
  them to nobody and fail `validateKit`:
  ```ts
  type RoleExtraction = {
    title: string;            // → role.title        (verbatim-ish from the JD)
    seniority: string;        // → role.seniority    ('' when the JD does not say — never guessed)
    location: string;         // → source.location   ('' when absent)
    company_from_jd: string;  // → candidate for source.company (see S2b)
    responsibilities: string[];   // → role.responsibilities (max 12, capped length)
    requirements: Requirement[];
    notes: KitNote[];
  }
  ```
  Empty string beats invention: an unstated seniority is `''`, and the UI shows "not stated".
  Inventing "Senior" because the salary looks high is precisely what loses extraction points.
- Pre: `normalizeJd()` — strip boilerplate/EEO blocks, collapse whitespace, cap at 24k chars.
- Prompt requires each requirement to quote a verbatim `source_span` from the JD.
- Post-filter in code: drop any requirement whose `source_span` is not found in the JD
  (normalized compare). **This is the anti-invention guard, and it is code, not trust.**
- **Provenance offsets are defined against the ORIGINAL jd string, always.** `normalizeJd`
  returns `{ text, map }` where `map` translates a normalized index back to an original index;
  spans are located in `text`, then mapped back before being stored. Without this, `start`/`end`
  point into a string the user never sees, and the UI highlight lands on the wrong words.
  `jd_chars` is likewise measured on the original. One test: highlight a span in the original
  JD and assert it equals `source_span` exactly.
- `priority` heuristic override in code: spans under a "bonus/nice to have/plus/preferred"
  heading → forced `nice`; under "requirements/must/minimum" → `must`. Model's guess is
  the fallback only. (`packages/core/steps/priority-heuristics.ts`)
- Thin JD (<400 chars or ≤2 extracted): return what exists, push
  `notes: [{code:'THIN_JD'}]`. Never pad. A two-line JD yields a two-line kit that says so.

**S2 `crawlCompanySite(companyUrl, deps): Promise<SiteCrawl>`**
- `packages/core/steps/crawl.ts`
- `validateExternalUrl(url)` first (see §8) → normalize, follow ≤3 redirects.
- BFS, `maxDepth=2`, page budget per §4.3.1, **relative links resolved against the response
  URL** (Appendix B serves sites from `localhost:8099` — no host assumptions anywhere).
- **Same-site rule, and the `localhost` trap it has to survive.** "Same registrable domain"
  is the right rule for the open web and is *undefined* for `localhost`, a bare IP, or any
  host with no public suffix — a public-suffix lookup returns null, a naive comparison then
  rejects every internal link, and the crawl silently returns one page. That failure looks
  like "the fixture site has no hiring page" and would quietly cost research points on the
  graded run. So `isSameSite(a, b)`:
  1. no public suffix (localhost, `*.local`, bare IP, single-label host) → compare
     **hostname exactly** (plus port), so `localhost:8099` crawls normally;
  2. otherwise → compare eTLD+1 via the bundled public-suffix list, so `blog.acme.com`
     counts as the same site as `acme.com`.
  Tested against both a `localhost:8099` fixture and a subdomain fixture — the local case is
  the one the mandatory eval command actually exercises.
- robots.txt fetched once and honoured; a disallowed path is skipped and recorded.
- `rankLinks(anchors, base)` — scores each candidate link, no hard-coded path list:
  `+8` anchor text matches `/careers|jobs|join us|hiring|work with us/i`,
  `+6` matches `/interview|hiring process|how we hire|handbook/i`,
  `+4` `/about|team|culture|values|what we do/i`,
  `+3` `/engineering|blog/i`, `-4` depth>2, `-6` `/login|privacy|terms|cookie/i`,
  `+2` link in nav/footer, `+2` URL slug agrees with anchor text.
  Sitemap.xml, if present, feeds the same ranker rather than bypassing it.
- Each page: content-type allowlist, 2 MB cap, `extractMainText()` via Readability,
  keep first 8k chars + `<title>` + meta description.
- Returns `{ pages: FetchedPage[], candidates: RankedLink[], hiringCandidates: RankedLink[],
  skipped: SkipRecord[], robotsBlocked: string[], company_name: string }`.
- **`company_name` is produced here (S2b `resolveCompanyName`)** — this is the owner of
  Appendix A's `source.company`, resolved in code, in priority order: `og:site_name` →
  `<title>` with taglines/separators trimmed → JSON-LD `Organization.name` →
  `company_from_jd` from S1 → the URL's eTLD+1 label, title-cased. Never asked of the model
  and never empty, because `source.company` is required.
- **Never throws.** Total failure ⇒ `pages: []` + `skipped` with reason; the run continues.

#### 4.3.1 One page budget for the whole run (not per step)
§8's cap is a *run* budget, and three steps fetch pages, so they must share one counter or
the cap is fiction (12 + 3 + 4 = 19 against a stated 12).
`Deps.fetcher` therefore carries a **`FetchBudget { maxPages: 16, maxBytesTotal, used }`**,
decremented on every fetch by every step. Soft reservations keep one step from starving the
others: site crawl ≤10, hiring pages ≤3, public-discussion pages ≤3. A step that hits the
budget stops cleanly and records `BUDGET_EXHAUSTED` in `notes` rather than throwing.
§8 states the same number (16), and one test asserts a run never exceeds it.

**S3 `findHiringProcess(crawl, deps): Promise<HiringProcess>`**
- Fetch top ≤3 `hiringCandidates` not already fetched; ask the model to extract
  *stages, take-home?, system-design?, timeline, panel* **or return `found:false`**.
- `found:false` is a first-class, expected answer. No hiring page ⇒ `confidence:'none'`,
  note `NO_HIRING_PAGE`. Not an error, not a failure. (Brief tests exactly this case.)

**S4 `searchPublicDiscussion(company, role, hiring, deps): Promise<PublicSignal>`**
- **Runs even when S2/S3 found nothing — deliberately not chained to crawl success.** The
  brief tests an invalid/404 company URL, and public discussion is searchable from the company
  *name* alone, which S2b resolves from the URL even when zero pages were fetched. Treating a
  dead site as "no research possible" would throw away the one source still available and turn
  an `ok` case into a thin one. The only hard requirement is a usable company name.
- 2–3 queries max (`"<company> interview process"`, `"<company> <role> interview questions"`,
  `"<company> engineering hiring"`), dedupe by host, fetch top ≤4 results through the same
  guarded `Fetcher`, ≤2 per host.
- Zero results is normal: `{ hits: [], summary: null }` + note `NO_PUBLIC_DISCUSSION`.

**S5 `buildCompanyBrief(source, crawl, hiring, signal, deps): Promise<CompanyBrief>`**
- Grounding rule enforced in code: `sources` may only contain URLs that were actually
  fetched (`pages_used`). Any hallucinated URL is stripped, and if the brief cites nothing
  the summary is replaced by the honest `insufficient-evidence` template.
- `confidence` derived in code from evidence count, not asked of the model.

**S6 `generateQuestionsForCategory({category, requirements, hiring, brief, existing}, deps)`**
- `packages/core/steps/generate-questions.ts`
- Four calls (technical / behavioural / system-design / company-fit), run through the LLM
  queue with per-category prompt files under `core/prompts/`.
- Each call receives only the requirements plausibly served by that category (routed in code
  from `requirement.kind` + keyword rules), plus `existing` prompts to avoid duplicates.
- Every returned question must carry ≥1 `requirement_ids` that exists → invalid links
  dropped in code; a question with none left is discarded.
- `system-design` is skipped when seniority is junior and S3 found no design round —
  a company that publishes "take-home then system design" gets a different kit from one
  that says nothing. That is the sequencing being real.
- `difficulty` clamped to 1..3 in code.
- Flashcards from `generateFlashcards(requirements, questions, deps)` — one call, atomic
  facts, must reference requirement ids.

**S7 `runCoverageLoop(state, deps, {maxPasses=3})`**
- `packages/core/coverage.ts` — **pure, zero LLM, fully unit-tested**
  ```ts
  export function findCoverageGaps(requirements, questions): CoverageGap[]
  // a gap = requirement with no ACCEPTED question referencing its id; must-gaps sort first
  export function summarizeCoverage(requirements, questions, passes): Coverage
  export function acceptLink(q: Question, r: Requirement): boolean   // see below
  ```
- **Link quality gate — without this, coverage is checkable but not correct.** The diff trusts
  `question.requirement_ids`, so a model that tags every question `["r1","r2","r3","r4"]`
  scores flawless coverage with garbage links. Guarded in code, not by prompt:
  1. `requirement_ids.length > 3` → keep only the 3 best-scoring links (shotgun tagging).
  2. `acceptLink` requires evidence of a real relationship: lexical overlap between the
     question prompt+answer_outline and the requirement text — content-word Jaccard over
     stemmed tokens ≥ threshold, **or** a shared salient term (a capitalised/technical token
     from the requirement appearing in the question). Stopwords excluded.
  3. Rejected links are dropped **before** the coverage diff runs, so a bad link cannot close
     a gap. A question left with zero accepted links is discarded.
  4. Rejections are counted in `notes` (`LINKS_REJECTED`) — visible, not swallowed.
  Threshold is a named constant tuned against the fixture kits, with a test asserting both
  directions: an honest link is accepted, a shotgun-tagged one is not.
- Loop: pass 1 = full generation; then `findCoverageGaps` → if any `must` gap, call S6
  again *targeted at those requirement ids only* → recheck. Stop when no must-gaps or
  `maxPasses` reached. `coverage.passes` records the true count.
- After the last pass, any still-uncovered must-have gets a deterministic
  **fallback question** synthesized from the requirement text (template, no LLM) so the kit
  never ships with an uncovered must-have — and the event is recorded in `notes`
  (`FALLBACK_QUESTION_USED`) rather than hidden.
- README: 3 passes because pass 2 closes essentially all gaps in observed runs, pass 3 is
  insurance, and beyond that we are burning free-tier tokens for nothing.

**S8 `allocateSchedule(questions, requirements, daysAvailable, opts): Schedule`**
- `packages/core/schedule.ts` — **pure, zero LLM, fully unit-tested**
- Weight each question: `minutes = base[difficulty] * categoryFactor` (base 10/18/28).
- Sort by priority (`must` before `nice`), then difficulty desc, then category order —
  **harder and higher-priority material lands earlier, never the night before.**
- Allocate by capacity-balanced greedy into exactly `daysAvailable` buckets, front-loaded
  with a decaying target (`day 1..n` gets a slightly larger share early).

**Invariants — stated precisely, because the loose version contradicts itself.**
A day is one of two `kind`s: `'new'` or `'review'` (our extension, optional field).
  - **Every question has exactly one *first assignment***, on a `'new'` day. This — not
    "appears exactly once" — is the uniqueness invariant, and it is what the test asserts.
  - A `'review'` day may **repeat** question ids that were first assigned earlier. Repeats
    are legal *only* on review days, which makes the rule mechanically checkable.
  - Every question appears **at least** once; every `must` requirement appears on some day
    (post-check + repair move).
  - `days.length === daysAvailable`, exactly, always.
- **`days` far exceeds the material (e.g. `days=60`, 20 questions):** `'new'` days are filled
  first, then remaining days become `'review'` days that recycle ids by spaced-repetition
  spacing (`core/srs.ts` intervals) with a real focus label. Never a 0-minute filler day.
- **`days` is far too small (e.g. `days=1`, 200 questions):** the day still holds everything —
  dropping material would break "allocates all of it" — but `minutes` is **capped at
  `MAX_MINUTES_PER_DAY = 480`** and the shortfall is recorded honestly as a note
  (`SCHEDULE_OVERLOADED`, with `required_minutes` vs `allocated_minutes`) rather than emitting
  an absurd 3,000-minute day. The UI shows "more material than time — here's the priority order."
- `focus` derived in code from the dominant requirement/category of that day.
- Clamp `days` to `1..60` at the API/CLI boundary with `INVALID_INPUT` beyond it.
- Integrity rule 3 in §3.2 checks the *first-assignment* uniqueness rule above, not naive
  global uniqueness — the two must not be allowed to drift apart.

### 4.4 Orchestrator

```ts
// packages/core/pipeline.ts
export async function generateKit(input: GenerateKitInput, deps: Deps): Promise<PipelineResult>
```
- Runs S1→S8, emits a `StepEvent` per step (`step`, `status`, `detail`, `elapsedMs`).
- Each *research* step is wrapped in `softFail()`: it degrades to an empty result plus a
  note, and only S1 (nothing extractable AND nothing usable) or a total LLM outage
  produces a hard failure.
- Returns `{ kit, notes, stepLog, warnings }` after `validateKit`.
- Deterministic-mode flag (`temperature:0`, fixed rng) for fixture tests.

### 4.5 Resilience (`packages/core/resilience/`)
- `llm-queue.ts`: one `p-queue` (concurrency 1–2) + **token-bucket over tokens/min**, not
  just requests/min. Estimated prompt tokens are reserved before dispatch; the bucket
  refills on a timer. This is the "told to slow down" requirement handled *before* the 429.
- `retry.ts`: `p-retry`, exponential backoff + jitter, honours `Retry-After`, 5 attempts,
  retries 429/5xx/network only. Never retries a 4xx schema error.
- `provider-chain.ts`: Gemini → Groq on repeated 429, daily-cap or outage, recorded in `stepLog`.
- `json-repair.ts`: parse → strip code fences → extract outermost JSON → Zod → on failure,
  one repair call quoting the Zod error → still failing ⇒ that step soft-fails.
- `cache.ts`: content-hash cache of fetches and LLM calls in Mongo (CLI: on-disk in
  `.cache/`), keyed by `sha256(model + prompt + cacheSalt)`.
  **`cacheSalt` exists because a naive cache breaks the headline feature.** Regenerating a
  section replays the same prompt, so a prompt-keyed cache returns byte-identical questions
  and the 15-point regenerate button looks like a no-op on camera. Therefore:
  - `Deps.cache` carries an explicit **`policy: 'reuse' | 'bypass'`** per call.
  - **Retrieval (`Fetcher`) always `reuse`** — refetching the same company page during one
    run is waste, and page content is genuinely stable.
  - **LLM calls in a *first* generation `reuse`** (this is what makes the batch run fast and
    reruns cheap).
  - **LLM calls in a user-triggered regeneration `bypass`**, with `cacheSalt = jobId` and
    `temperature` nudged up, so output is genuinely new. Recorded on the job.
  - `--offline` forces `reuse` everywhere (that is the whole point of offline mode).
  A test asserts: same input twice in one run → 1 provider call; regenerate → a real second
  call with different output.

**Budget check for §9:** 5 cases × (4 category calls + 1 extract + 1 brief + 1 hiring +
~1 gap pass + 1 flashcards ≈ 9 calls) ≈ 45 calls. At concurrency 2 and ~6 s/call ≈ 2.5 min
of LLM plus crawling. Fifteen minutes is not tight, even with backoff.

---

## 5. The edit/regenerate state model (15 pts — the hardest part)

**Rule: the kit document is the single truth; every item carries its own lineage.**

```ts
meta: { origin: 'generated' | 'edited' | 'manual', pinned: boolean, updated_at: string }
```

`packages/core/merge.ts` — pure, heavily tested:

```ts
export function mergeSection<T extends {id:string; meta?:ItemMeta}>(
  existing: T[], regenerated: T[], scope: SectionScope
): MergeResult<T>
```
**Ingest normalisation (must run before any rule below).** Model output has no `meta`, and
every rule here branches on it, so `normalizeMeta(items, origin)` stamps
`{origin, pinned:false, updated_at}` on ingest. `meta` stays `.optional()` in the schema for
Appendix-A strictness, but is **always present in memory and in the DB** — no rule is ever
allowed to read `undefined`. Enforced by a Zod-transform default at the repository boundary.

Rules, in order:
1. `origin:'manual'` → **always kept**, never replaced.
2. `origin:'edited'` or `pinned:true` → kept; the regenerated candidate that would have
   replaced it is dropped (not silently merged into it).
3. `origin:'generated'` **and inside the regenerated scope** → replaced.
4. `origin:'generated'` **outside the scope** → untouched. Regenerating the technical
   category cannot touch behavioural questions, the flashcards, or the brief.
5. New ids never collide: `nextId(prefix, existingIds)` monotonic per kit.
6. **User ordering is state, and it survives.** Position is not captured by `origin`/`pinned`,
   so the kit carries an explicit `order: string[]` per section (our extension; the canonical
   array is rendered through it). `mergeOrder(existingOrder, kept, incoming)`:
   kept items hold their **relative** positions, replaced items take the slot of the item they
   replaced, genuinely new items append. A regeneration therefore never re-sorts a list the
   user arranged by hand. Reorder writes `order` only — never item bodies.

Scopes: `company_brief`, `questions:<category>`, `flashcards`, `schedule`.

### 5.1 The schedule is derived — but derived is not the same as disposable
Rule 4 said a question regeneration must not touch the schedule; the schedule also has to
reflect questions that no longer exist. Both are satisfied by recomputing **only what the
change invalidates**, never the whole thing:

`reconcileSchedule(existing, kit, changedIds): Schedule`
1. Ids that vanished are removed from their days. Ids that are new are inserted using
   `allocateSchedule`'s priority ordering **into the existing day structure** — day count,
   day order and every `focus` string are left alone.
2. A day whose `focus` or `question_ids` the user edited is marked `meta.origin:'edited'` and
   is **frozen**: reconciliation may only *remove dead ids* from it, never add or reorder.
3. `allocateSchedule` runs from scratch **only** for `scope:'schedule'` (the user explicitly
   asked for a new schedule) or on first generation. Edited days still survive that via
   `mergeSection` rules 1–2 applied to days.
4. Then `findCoverageGaps` + `validateKit`. If reconciliation would break an invariant
   (a must-have left unscheduled), it appends to the earliest non-frozen day and notes
   `SCHEDULE_RECONCILED` — it never silently drops a must-have and never rewrites a frozen day.

Headline test: *edit day 2's focus, hand-write a question, pin another, reorder technical,
then regenerate technical* → the edit, the manual question, the pin, the order and day 2 are
all byte-identical afterwards; only unpinned generated technical questions changed.

**Concurrency — scoped, because one global counter fights the optimistic UI.** A single
document `version` bumped by *every* mutation means a debounced reorder invalidates an
in-flight edit to an unrelated question, producing 409s on writes that never conflicted.
So the guard matches the blast radius of the write:
- **Item-level writes** (`PATCH items/:itemId`, `PATCH order`, add, delete) → narrow update on
  the item's own path (`$set: {'kit.questions.$[e].prompt': …}` via an array filter) with a
  per-item `meta.updated_at` precondition. No document version guard, so concurrent edits to
  *different* items both succeed. Two edits to the *same* item: last-write-wins, and the
  loser is told (`ITEM_CHANGED` toast with a reload action).
- **Section-level writes** (regeneration, `scope:'schedule'` reallocation) → full
  `updateOne({_id, version}, {$inc:{version:1}})` optimistic guard, because these replace
  whole arrays. A stale write returns **409 with the current document** so the client rebases.
- The document `version` still increments on section writes, so the client can detect
  "the section moved under me" and re-render — it just no longer gates every keystroke.

Client side: edits are optimistic (Zustand draft + TanStack Query mutation), reorder is
local-first with a single debounced (400 ms) persist of the new id order — no round trip per
keystroke or per drag frame.

---

## 6. Backend (`apps/api`) — layers

```
routes/ (HTTP only)  →  services/ (use cases)  →  packages/core + packages/db
middleware/          auth, requestId, zodValidate, rateLimit, errorHandler
```
Routes never touch Mongo or `core` directly. Services never touch `req`/`res`.

### 6.1 Endpoints
```
POST   /api/auth/register        { email, password }              → sets cookie
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/kits                                                  → list (owner-scoped)
POST   /api/kits                 { jd, company_url, days }        → 202 { kitId, jobId }
POST   /api/kits/batch           multipart file | { cases[] }     → 202 { jobIds[] }
GET    /api/kits/:id                                              → kit + job status
DELETE /api/kits/:id
PATCH  /api/kits/:id/items/:itemId   { patch }                    → single item edit
PATCH  /api/kits/:id/order           { section, ids[] }           → reorder / move category
POST   /api/kits/:id/items           { section, item }            → manual add
DELETE /api/kits/:id/items/:itemId
POST   /api/kits/:id/regenerate      { scope }                    → 202 { jobId }
POST   /api/kits/:id/practice        { cardId, confidence }       → practice event
GET    /api/kits/:id/weak-spots                                   → creative feature
GET    /api/jobs/:id/stream                                       → SSE progress
GET    /api/health
```
Every body/param parsed by a Zod schema from `packages/schema/api.ts`. Every response
either `{ data }` or `{ error: { code, message, details? } }` — one shape, one error handler.

### 6.2 Job runner (`apps/api/services/job-runner.ts`)
Generation takes 60–120 s, so the HTTP request must not own it.
- `POST /api/kits` → insert `kits` doc `status:'queued'` + `jobs` doc → **202 immediately**.
- In-process runner: `p-queue` with concurrency 2, picks up jobs, calls `generateKit` with a
  `ProgressSink` that writes each `StepEvent` to the job doc **and** publishes to an
  `EventEmitter` that SSE subscribers read.
- **Idempotency:** `idemKey = sha256(userId + normalizedJd + normalizedUrl + days)` unique
  index. Same posting submitted twice within 24 h returns the existing kit/job (200, not a
  second run) — the brief's "triggered twice for the same posting".
- Crash/restart recovery: on boot, jobs stuck `running` past a lease TTL are marked
  `failed` with `INTERNAL` and are resumable via regenerate; a half-finished kit keeps the
  sections it completed and shows them as partial rather than vanishing.
- **Free-tier idling makes this recovery path load-bearing, not decorative.** A platform that
  sleeps an idle instance (Render free) will kill a 90-second job and its SSE stream mid-run,
  and a grader's first request pays a 30–60 s cold start. Consequences designed for:
  the job doc is the source of truth (the SSE stream is only a view of it), progress is
  persisted per step so a resumed/retried job never loses completed sections, and the lease
  sweep on boot reconciles anything the shutdown interrupted. See §15 for the hosting choice.
- **Why in-process and not BullMQ/Redis:** free-tier deploy, single API instance, and the
  queue is the same abstraction the CLI uses. Documented as a known limitation with the
  upgrade path (swap `JobQueue` for BullMQ — one port).

### 6.3 Persistence (`packages/db`)
Collections + indexes:
- `users` — `{ email(unique), passwordHash, createdAt }`
- `kits` — `{ _id, userId, status, version, kit, stepLog, idemKey, promptVersion,
  createdAt, updatedAt }` → `{userId:1, updatedAt:-1}`, `{idemKey:1} unique sparse`
  **`notes` lives only at `kit.notes` (§3.1) — never duplicated at document level.** It is
  part of the kit the CLI emits and the UI renders, so a second copy is a second truth that
  will drift. `stepLog` is the opposite case: it is *run* metadata, not kit content, so it
  stays outside `kit` and is never written to the batch output.
- `jobs` — `{ _id, kitId, userId, type, scope, status, steps[], error, leaseUntil }`
  → `{status:1, leaseUntil:1}`
- `practice_events` — `{ userId, kitId, cardId, confidence, at }` → `{userId:1,kitId:1,at:-1}`
- `cache` — `{ _id: hash, kind, value, createdAt }` → TTL 7 days

Repositories expose intent, not queries: `kitRepo.findOwned(userId, id)`,
`kitRepo.replaceKit(id, version, kit)`. **Ownership is a repository-level filter**
(`userId` always in the query), not a controller `if` — that's how "users see only their
own kits" stops being forgettable.

---

## 7. LLM providers (`apps/api/adapters`, `packages/core/ports`)
- `GeminiProvider` (**primary**) — `gemini-2.5-flash` via Google AI Studio key,
  `responseMimeType: 'application/json'`, temperature 0.2–0.4 by step.
  **`responseSchema` accepts only a restricted OpenAPI subset**, not arbitrary JSON Schema:
  no `$ref`, no `anyOf`/union gymnastics, limited nesting. Handing it a
  `zod-to-json-schema` dump of the whole nested `Kit` is the predictable way to get a 400.
  So: **one small, flat, hand-written response schema per step** (a requirements array, a
  questions array, a brief object) — never the composite kit — passed through
  `flattenForGemini()` which strips unsupported keywords and inlines refs. `Kit` is assembled
  in *our* code from the step outputs, which is where it belonged anyway.
  Zod remains the authority: whatever the model returns is parsed and rejected by Zod
  regardless of what the provider claims to have enforced. T-C.0 verifies each step schema
  against the live API on Day 1 — this is exactly the class of thing a fake LLM hides. Free tier needs **no credit card**; limits are per-minute
  *and* per-day, so the token bucket in §4.5 is sized from the current AI Studio quota page
  (they change — read them, don't hard-code a guess) and `LLM_TPM`/`LLM_RPM` are env vars.
- `GroqProvider` (**fallback**) — `llama-3.3-70b-versatile`, JSON mode. Also free without a
  card. `provider-chain.ts` fails over on repeated 429 or a daily-cap error, and records the
  switch in `stepLog` so the kit says which model produced it.
- README note: Gemini's free tier may use prompts to improve Google's products. Inputs here
  are public job descriptions and public web pages, so this is acceptable — stated, not hidden.
  `LLM_PROVIDER=groq` forces a single provider for anyone who would rather not.
- Both emit `{ text, usage, model }`; token usage aggregated per kit and surfaced in the UI
  footer (cheap credibility, near-zero cost).
- Prompts live as versioned files in `packages/core/prompts/*.ts`, each exporting
  `{ id, version, system, build(input) }`. `promptVersion` is stored on the kit so a kit
  can be explained after the prompts move on.

---

## 8. Security (`packages/core/security/`, `apps/api/middleware/`)
- `validateExternalUrl(raw, {allowPrivate})`: http/https only, no credentials in URL,
  DNS-resolve and **reject loopback/private/link-local/CGNAT ranges in production**.
  Re-validated on **every redirect hop** — that's where SSRF actually lands.
- **Port rule, stated carefully, because a naive one rejects the graders' own harness.**
  Appendix B's example company URL is `http://localhost:8099/acme/` — a non-standard port.
  A blanket "standard ports only" rule would make the mandatory eval command fail on its
  own fixture. So:
  - **production** (`ALLOW_PRIVATE_URLS` unset): ports **80/443 only**, public addresses only.
  - **dev/eval** (`ALLOW_PRIVATE_URLS=true`): any port, loopback and private ranges allowed.
    This is the single switch that makes §9 work locally without weakening the deployed app.
  The blast radius is bounded: the flag is off in the deployed environment, is documented in
  `.env.example` as eval-only, and is logged loudly at boot when on.
  Test matrix covers both settings — `localhost:8099` **accepted** with the flag,
  **rejected** without it.
- Content-type allowlist (`text/html`, `text/plain`, `application/xhtml+xml`),
  `Content-Length` + streaming byte cap (2 MB), 10 s timeout, and **16 pages per run total,
  shared across all fetching steps via the `FetchBudget` in §4.3.1** (a per-step cap is not a
  cap — three steps fetching 12 each is 36 pages).
- **Prompt injection:** all fetched text and the pasted JD are wrapped in
  `packages/core/security/sanitize.ts::asUntrustedBlock(text)` — delimited, escaped, and
  preceded by a standing instruction that content inside is *data to analyse, never
  instructions*. Model outputs are then re-validated against Zod + integrity, so even a
  successful injection cannot produce a structurally invalid or cross-tenant kit.
- Auth: argon2id, httpOnly + `Secure` cookie, 7-day JWT, `jose` verify, expired token → 401
  with `SESSION_EXPIRED` → web redirects to login preserving the return path.
- **Cookie `SameSite` is deployment-shaped, and this is a real trap.** Vercel `*.vercel.app`
  and a `*.fly.dev`/`*.onrender.com` API are different registrable domains, so every API call
  is **cross-site** and a `SameSite=Lax` cookie is silently *not sent* — local dev works,
  production is logged out. Two supported configurations, chosen by env:
  - **Preferred (`COOKIE_MODE=same-site`)** — serve both from one apex domain
    (`app.example.com` + `api.example.com`, `COOKIE_DOMAIN=.example.com`) → `SameSite=Lax`
    and the whole problem class disappears. This is the deploy target.
  - **Fallback (`COOKIE_MODE=cross-site`)** — raw platform subdomains → `SameSite=None; Secure`
    (mandatory: `None` without `Secure` is rejected by browsers), and CORS must send
    `credentials: true` with an **explicit origin echo** — `Access-Control-Allow-Origin: *`
    is illegal alongside credentials and fails silently.
  - CSRF: `SameSite=None` gives up the browser's own CSRF protection, so in cross-site mode
    mutating routes additionally require an `Origin` header match against the allowlist
    (cheap, no token round-trip, sufficient for a cookie+CORS API).
- `apps/api/config/cookies.ts` is the **only** place cookie flags are set, with a unit test
  asserting both modes; no route sets its own.
- Frontend must send `credentials: 'include'` on every request — centralised in
  `lib/api-client.ts`, never per-call.
- `helmet`, strict CORS allowlist (`CORS_ORIGINS` env, comma-separated, no wildcard),
  `express-rate-limit` on auth + generation routes, request size caps, no secrets in logs,
  structured logs with `requestId`.
- **Verify before Day 3:** deploy the auth route first and confirm login survives a real
  cross-origin browser request. Do not discover this while recording the video.

---

## 9. Batch entry point (frozen)
```
npm run evaluate -- --input fixtures/cases.example.json --output kits.json
```
- Root `package.json`: `"evaluate": "tsx packages/core/cli/evaluate.ts"` (no build step
  needed from a clean clone; `npm install` then run).
- Reads `BatchCase[]`, validates each; runs **the same `generateKit`** with the same steps —
  no parallel implementation. Concurrency 2, per-case timeout 150 s.
- Per case: `try/catch` → `{ id, status:'ok', kit, error:null }` or
  `{ id, status:'failed', kit:null, error:{code,message} }`. **One failure never aborts the
  run**; results are written even if the process is interrupted (incremental flush to a
  temp file, atomic rename at the end).
- `status:'failed'` is reserved for "no kit at all". A missing hiring page, no public
  discussion, or a thin JD is `ok` with the gap in `kit.notes` and `coverage`.
- **`--offline` only works if the cache ships with the repo.** The claim is "a grader with no
  API key can run the pipeline", so `.cache/` is **committed** (§2), generated once by
  `npm run seed:cache` against the fixture cases and regenerated whenever prompts change.
  In offline mode a cache **miss is a hard, loud error** (`LLM_UNAVAILABLE` naming the missing
  key) — never a silent fallback to a live call that would fail without a key, and never a
  fabricated result. CI runs the offline path on every push, so a stale cache breaks the build
  rather than the demo. Cache files are small JSON (a few hundred KB) — acceptable in git.
- Credentials from env only, documented in `.env.example`; `--offline` flag uses the local
  fixture server + cache so graders can run it without any key at all (documented bonus).
- Prints a summary table: per-case status, passes, uncovered musts, elapsed, tokens.

---

## 10. Frontend (`apps/web`)

### 10.1 Routes
```
/(auth)/login, /(auth)/register
/(app)/kits                     list + empty state + "New kit"
/(app)/kits/new                 single + batch upload tabs
/(app)/kits/[id]                generating → builder (server-rendered shell)
/(app)/kits/[id]/practice       flashcard practice
/(app)/kits/[id]/weak-spots     creative feature
```

### 10.2 Design system — uniformity by construction
- `app/globals.css` defines **semantic tokens only**: `--bg, --surface, --surface-muted,
  --border, --fg, --fg-muted, --accent, --accent-fg, --success, --warning, --danger`,
  plus radius/spacing/shadow scales. Light + dark via `prefers-color-scheme` and
  `[data-theme]`. **No component may use a raw hex or a raw Tailwind color** —
  enforced by an ESLint rule + a review checklist item.
- Type scale: 6 steps. Spacing: 4 px base, tokens only. One radius family.
- Motion: 120/180/240 ms, `prefers-reduced-motion` respected.

### 10.3 Component inventory (build once, reuse everywhere)
`components/ui/` (primitives): `Button, IconButton, Input, Textarea, Select, Label, Field,
Card, Badge, Chip, Tabs, Dialog, Sheet, DropdownMenu, Tooltip, Toast, Progress, Skeleton,
Separator, ScrollArea, Kbd, Switch, Spinner`.

`components/patterns/` (composed, the actual reuse win):
- `SectionCard` — header + title + `RegenerateButton` + body. **Every kit section uses it**;
  that is what makes the page look like one product.
- `AsyncBoundary` — one component wrapping `{loading, empty, error, retry}`. Every data
  region on every page goes through it, so loading/empty/error are literally impossible to
  style inconsistently.
- `EditableText` — inline edit (click/Enter to edit, Esc cancel, Cmd+Enter save), optimistic,
  shows `edited` badge. Used by questions, answers, flashcards, brief, day focus.
- `SortableList` — dnd-kit wrapper with full keyboard support (Space to lift, arrows to move,
  Space to drop, live region announcement).
- `OriginBadge` / `PinToggle` — makes the generated/edited/pinned state *visible*, which is
  what the graders are looking for.
- `EmptyState`, `ErrorState`, `ConfirmDialog`, `PageHeader`, `StatChip`, `CoverageMeter`,
  `StepTimeline` (SSE progress), `DiffPreview` (regeneration: what changes vs what is kept).

`components/kit/`: `KitHeader, CompanyBriefSection, RoleSection, RequirementList,
QuestionBank (category tabs), QuestionCard, FlashcardList, ScheduleSection, DayCard,
CoveragePanel, NotesPanel`.

### 10.4 Interaction design specifics (10 pts)
- **Generating:** `StepTimeline` over SSE — the eight steps with per-step status and
  elapsed time; a step that soft-failed shows amber "skipped: unreachable", not red.
- **SSE must be treated as unreliable, not as the state.** The job document is the truth; the
  stream is an optimisation. `useJobProgress(jobId)` reconnects with capped backoff, and after
  2 failures **falls back to polling `GET /api/kits/:id` every 3 s** — so a proxy that buffers
  SSE, an instance that cold-starts mid-run, or a flaky network degrades to "slower progress
  bar", never to a spinner that lies forever. A job that stops advancing past its lease shows
  a real failure state with a retry action.
- **Partial failure:** sections that arrived render immediately; missing ones show
  `EmptyState` + "Regenerate this section".
- **Regeneration:** target section shows a shimmer overlay while the rest stays interactive
  and editable. On completion, a `DiffPreview` toast: "6 questions replaced, 3 of your edits
  kept." An edit in flight is never clobbered — the 409/version rebase path is user-visible.
- **Responsive:** single column ≤768 px with a sticky section nav; two-column
  (nav + content) ≥1024 px; `Sheet` replaces `Dialog` on mobile.
- **Keyboard:** skip link, visible focus rings, `Cmd+K` command palette (jump to section,
  regenerate, start practice), `j/k` in practice, roving tabindex in lists, all dialogs
  focus-trapped, `aria-live` for save/regenerate/reorder announcements.
- **Honesty in the UI:** `NotesPanel` renders `THIN_JD`, `NO_HIRING_PAGE`,
  `NO_PUBLIC_DISCUSSION`, `FALLBACK_QUESTION_USED` as plain sentences. Reporting a thin
  result well is worth more here than faking a rich one.

### 10.5 Practice mode + creative feature
- `packages/core/srs.ts` — **pure**: `nextReviewAt(card, confidence)` (SM-2-lite: intervals
  1/3/7/14 d scaled by confidence 1–3) and `orderSession(cards, events)` — least-confident
  and overdue first, unseen before seen. Defended in README: full SM-2 without a long-term
  user history is theatre; confidence-weighted + a simple interval is honest and testable.
- Practice UI: one card at a time, reveal answer, confidence 1–3, progress
  (`12/40 covered`), session summary, resume where you left off.
- **Creative feature — "Weak Spots" report** (`/weak-spots`): joins practice confidence ×
  requirement priority × question difficulty × coverage to rank *requirements* (not cards)
  you are least ready for, with the exact questions to drill and a one-click "build a
  focused 1-day schedule from my weak spots" that reuses `allocateSchedule` — so the feature
  is 40 lines of joining, not a new subsystem. Real problem it solves: people practise what
  they already know; this points at the must-have requirement they keep flunking.

---

## 11. Tests (`10 robustness pts + code-quality pts`)
Priority order — the brief names these three explicitly:
1. `packages/core/schedule.test.ts` — days=1, days=60, 1 question, 200 questions, exact day
   count, every must present, **one first assignment per question and repeats only on review
   days**, `MAX_MINUTES_PER_DAY` cap + `SCHEDULE_OVERLOADED` note on `days=1`/200 questions,
   integer minutes, front-loading (mean difficulty of day 1 > day n), determinism.
2. `packages/core/coverage.test.ts` — gap detection, must-first ordering, loop closes gaps,
   `passes` counted honestly, fallback question path, **and the link-quality gate both ways:
   an honest link is accepted, a shotgun-tagged question does not close a gap**.
3. `packages/schema/integrity.test.ts` — every rule in §3.2, with a valid kit fixture and one
   mutated fixture per rule.
4. `packages/core/merge.test.ts` — all six merge rules + `mergeOrder` + `reconcileSchedule`
   (§5, §5.1). Headline case: *edit a day focus, hand-write a question, pin another, reorder
   technical, then regenerate technical* → edit, manual item, pin, user order and the frozen
   day are byte-identical; only unpinned generated technical questions changed. Plus:
   `normalizeMeta` never leaves `meta` undefined; a vanished question id is removed from its
   day; a must-have never ends up unscheduled after reconciliation.
4b. `packages/core/resilience/cache.test.ts` — same call twice in one run = 1 provider call;
   a regeneration **bypasses** the cache and produces different output (guards against the
   regenerate button becoming a silent no-op); `--offline` reuses everywhere.
5. `packages/core/steps/crawl.test.ts` — link ranking, robots, relative links against a
   `localhost` fixture site, **`isSameSite` on `localhost:8099` and on a subdomain** (the
   no-public-suffix case is what the mandatory eval command exercises), redirect SSRF
   rejection, byte cap, and the shared `FetchBudget` never being exceeded across S2+S3+S4.
5b. `packages/core/steps/extract.test.ts` — `title`/`seniority`/`location`/`responsibilities`
   are populated or honestly `''`; a fabricated `source_span` is dropped; **provenance offsets
   map back to the ORIGINAL jd** (highlight equals `source_span`); thin-JD path notes and
   does not pad; `resolveCompanyName` falls through all five sources including a dead site.
6. `packages/core/security/url.test.ts` — the private/loopback matrix.
7. `packages/core/pipeline.test.ts` — full run against fake LLM + fixture site: happy path,
   404 company, no hiring page, thin JD, invalid model JSON, 429-then-succeed.
8. `apps/api/*.int.test.ts` — supertest: auth gates, cross-user 404 (not 403), idempotent
   double POST, cookie flags correct in both `COOKIE_MODE`s, CORS rejecting an origin outside
   the allowlist while echoing one inside it, and the **scoped concurrency contract**:
   concurrent edits to two different items both succeed, a stale *section* write gets 409 with
   the current document, a stale *item* write gets `ITEM_CHANGED`.
9. `apps/web` — Testing Library on `EditableText`, `SortableList` keyboard, `AsyncBoundary`.

CI: GitHub Actions — install, typecheck, lint, test, build, then
`npm run evaluate -- --input fixtures/cases.example.json --offline` as a smoke test.

---

## 12. Parallel build plan — phases, owners, and why nothing collides

Each task lists **files owned exclusively** by that task. Two tasks never write the same
file. Cross-task communication happens only through `packages/schema` and `core/ports.ts`,
which are frozen at the end of Phase 0.

### Phase 0 — foundation (sequential, ~2 h, one agent, must land first)
- **T0.1** repo scaffold: **npm workspaces** (§2), tsconfig base, ESLint (incl. the
  layer-boundary and no-raw-color rules), prettier, vitest config, CI, `.env.example`.
- **T0.2** `packages/schema/**` — kit, api, batch, integrity + `integrity.test.ts`.
- **T0.3** `packages/core/ports.ts`, `errors.ts`, `notes.ts`, fake adapters in
  `packages/core/testing/` (FakeLlm, FakeFetcher, FakeSearch, FixedClock).
- **T0.4** `fixtures/` — kit fixture, 5 cases, 3 fixture sites (rich site with a hiring
  handbook, a site with no hiring page anywhere, a 404 domain), `tools/local-site-server.ts`.
- **Gate:** `npm run typecheck && npm test` green, **and the clean-clone acceptance test
  in §2 passes in CI**. **Contracts frozen.**

### Phase 1 — five parallel tracks (no shared files)

| Track | Agent | Owns exclusively | Depends on |
|---|---|---|---|
| **A — deterministic core** | 1 | `core/schedule.ts`, `core/coverage.ts`, `core/merge.ts`, `core/srs.ts`, `core/ids.ts` + their tests | schema only |
| **B — retrieval** | 2 | `core/steps/crawl.ts`, `find-hiring.ts`, `search-public.ts`, `core/security/url.ts`, `sanitize.ts`, `core/html/*` + tests | schema, ports, fixtures |
| **C — LLM steps** | 3 | `core/steps/extract.ts`, `priority-heuristics.ts`, `build-brief.ts`, `generate-questions.ts`, `generate-flashcards.ts`, `core/prompts/*`, `core/resilience/*` + tests | schema, ports, fakes, **+ a real Gemini key from hour one** |
| **D — data + API skeleton** | 4 | `packages/db/**`, `apps/api/{app.ts,server.ts,middleware/**,routes/auth.ts,services/auth.ts}` + auth int tests | schema |
| **E — web shell + design system** | 5 | `apps/web/app/globals.css`, `components/ui/**`, `components/patterns/**`, auth pages, kit list page, `lib/api-client.ts` (typed from `schema/api.ts`) | schema |

Tracks A/B/C are pure and testable with fakes, so none of them needs the API or DB to exist.
Track E builds every pattern component against a static kit fixture, so it needs no backend.

> **Track C is the exception to "fakes are enough", and this is the plan's biggest schedule
> risk.** `FakeLlm` proves the plumbing and proves nothing about extraction *quality* — which
> is the single largest line item on the grading scale (20 pts). A prompt that satisfies a fake
> can still miss half the must-haves in a real posting.
> **T-C.0, before any interface work:** a throwaway script
> (`packages/core/prompts/scratch/probe.ts`) that hits real Gemini with **three real job
> descriptions** — one dense senior posting, one thin two-line stub, one non-engineering — and
> prints extracted requirements next to the JD. Hand-score them against what a human would
> extract. Iterate the prompt *there* until it holds up, then port the winning prompt into
> `core/prompts/`. Everything else in Track C is plumbing around that prompt.
> The same probe output becomes the golden fixture for `FakeLlm`, so the fakes are then
> grounded in real model behaviour instead of in what I imagined it would return.

### Phase 2 — integration (three parallel tracks)
| Track | Agent | Owns |
|---|---|---|
| **F — pipeline** | 1 or 3 | `core/pipeline.ts` (wires A+B+C), `core/cli/evaluate.ts`, pipeline tests |
| **G — kit API** | 4 | `apps/api/routes/kits.ts`, `services/kit-service.ts`, `services/job-runner.ts`, SSE, `adapters/{groq,gemini,fetcher,search}.ts` |
| **H — builder UI** | 5 (+6) | `components/kit/**`, `app/(app)/kits/[id]/**`, generating view + SSE client, optimistic edit/reorder store |

### Phase 3 — features (parallel)
- **I** practice mode UI + `practice` endpoints (uses `core/srs` from Track A)
- **J** weak-spots report (API + page)
- **K** README, `.env.example` prose, deployment (Vercel + Render + Atlas), walkthrough
  video script

### Phase 4 — hardening (sequential, one agent)
Run the 8 edge cases from §10 of the brief end to end, timing check on the batch command,
Lighthouse + keyboard + mobile pass, error-message copy review, commit history tidy.

**Agent working agreement**
1. Never edit a file outside your track's owned list. Need a change in someone else's file?
   Write it in `HANDOFF.md` under their track heading.
2. Never change `packages/schema` or `core/ports.ts` after Phase 0 without updating PLAN.md
   in the same commit.
3. Every non-trivial function ships with its test in the same commit.
4. Commits: `feat(core/schedule): allocate must-haves front-loaded` — small, meaningful,
   reflecting real development order (the brief grades commit history).
5. No new dependency without adding it to §1 with a one-line justification.

---

## 13. Timebox (4 days, day 4 is slack)
- **Day 1** Phase 0; **T-C.0 prompt probe against real Gemini**; Phase 1 tracks A–E started;
  deterministic core done and tested; **deploy the auth route and prove the cookie works
  cross-origin** (§8 — this is a Day 1 task precisely because it is a Day 3 disaster).
- **Day 2** Phase 1 finished, Phase 2 F+G; first real end-to-end kit; `evaluate` running.
- **Day 3** Phase 2 H, Phase 3 I/J, full deploy, README.
- **Day 4** Phase 4 hardening, video, submit with margin.

### 13.1 This plan is over-scoped for one person — the cut list is pre-agreed
14 sections, 5 packages, ~30 components and 9 test files is a five-agent plan. Solo, Phase 3
collides with the Day 4 slack, and slack is exactly what absorbs the cookie and quality
surprises above. **Decide the cuts now, while calm, not at 2 a.m. on Day 3.**

Cut in this order, and stop as soon as you are back on schedule:
1. `Cmd+K` command palette
2. Token-usage footer
3. `DiffPreview` component → a plain toast sentence carries the same information
4. Batch **upload UI** (the §9 CLI already satisfies the mandatory batch requirement)
5. Dark mode (keep the tokens; ship light only)
6. Posting-comparison feature (never in scope; do not add it)

**Never cut, at any hour:** the deterministic core (`schedule`/`coverage`/`merge`) and its
tests, the link-quality gate, honest `notes`, the auth/ownership boundary, `validateKit`
before every write, and the `evaluate` CLI. Those are ~45 of the available points; everything
in the cut list above is worth single-digit polish.

---

## 14. Known limitations to state in the README (honesty scores here)
**Deliberately not built** (each is a cost with no scored benefit — the reasoning is the point):
- *Redis/BullMQ* — one free-tier API instance at concurrency 2. The `JobQueue` port exists so
  BullMQ is a ~30-line adapter; adding it now means another deployed service that can fail
  during a demo, for zero grading points.
- *Headless browser* — won't fit the free tier reliably, ~300 MB, and threatens the 15-minute
  batch budget. Cost: JS-rendered marketing sites yield thin text. Accepted and recorded via
  `THIN_PAGE` notes rather than silently.
- *Mongoose* — Zod already validates at the boundary; a second schema is a second source of
  truth that can disagree with the first.
- *Auth.js* — email verification, reset and roles are out of scope, and the session must be
  verified inside Express, not only in Next.

Single-instance in-process job queue (no Redis) — upgrade path is one port swap.
Crawl capped at 12 pages / depth 2 — JS-rendered sites yield little (no headless browser
on a free tier; documented, not hidden). Search via DuckDuckGo HTML is best-effort and can
be throttled. `notes`/`meta` are additive extensions to Appendix A, all optional.
No email verification, password reset or roles — explicitly out of scope.

---

## 15. Hosting decision (why not Render free)
Render's free web service sleeps after ~15 minutes idle. This app's characteristic workload is
a 60–120 s in-process job streaming progress — the worst possible fit for an instance that can
be suspended mid-run, and a grader arriving cold waits 30–60 s before seeing anything.
- **API → Fly.io** free allowance, `min_machines_running = 1` so it does not sleep. Health
  check at `/api/health`.
- **Web → Vercel** free (no sleep; edge-served).
- **DB → Atlas M0**, IP allowlist set to the API's egress, separate DB user for the app.
- Both mapped under one apex domain so §8's `same-site` cookie mode is the deployed path.
- If Fly is unavailable, Render still works — the job doc + polling fallback (§6.2, §10.4) is
  precisely the design that survives it. Record the trade-off in the README rather than
  pretending the platform is irrelevant.
