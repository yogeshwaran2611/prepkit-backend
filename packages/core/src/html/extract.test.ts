import { describe, expect, it } from 'vitest';
import { extractPage, rankLinks, resolveCompanyName } from './extract.js';

const page = (body: string, head = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('extractPage', () => {
  it('pulls title, description and readable text', () => {
    const html = page(
      '<nav><a href="/careers/">Careers</a></nav><main><h1>Hello</h1><p>We build ports software.</p></main>',
      '<title>Acme</title><meta name="description" content="Ports software">',
    );
    const out = extractPage(html, 'https://acme.test/');
    expect(out.title).toBe('Acme');
    expect(out.description).toBe('Ports software');
    expect(out.text).toContain('We build ports software');
  });

  it('drops script and style content rather than feeding it to a model', () => {
    const html = page('<main><p>Real text</p><script>alert("no")</script><style>.x{}</style></main>');
    const out = extractPage(html, 'https://acme.test/');
    expect(out.text).toContain('Real text');
    expect(out.text).not.toContain('alert');
  });

  it('resolves relative links against the page URL — Appendix B depends on this', () => {
    const html = page('<a href="careers/">Careers</a><a href="../about/">About</a>');
    const out = extractPage(html, 'http://localhost:8099/acme/');
    expect(out.links.map((l) => l.href)).toContain('http://localhost:8099/acme/careers/');
    expect(out.links.map((l) => l.href)).toContain('http://localhost:8099/about/');
  });

  it('ignores mailto, tel and fragment links', () => {
    const html = page('<a href="mailto:a@b.c">Mail</a><a href="tel:123">Call</a><a href="#top">Top</a>');
    expect(extractPage(html, 'https://acme.test/').links).toHaveLength(0);
  });

  it('reads og:site_name for the company name', () => {
    const html = page('<main>x</main>', '<meta property="og:site_name" content="Acme Freight">');
    expect(extractPage(html, 'https://acme.test/').siteName).toBe('Acme Freight');
  });
});

describe('rankLinks — no hard-coded path list', () => {
  const base = 'https://acme.test/';
  const link = (href: string, text: string, inNav = false) => ({ href, text, inNav });

  it('ranks a hiring-process page above a generic careers page', () => {
    const ranked = rankLinks(
      [link(`${base}careers/`, 'Careers'), link(`${base}handbook/how-we-hire/`, 'How we hire')],
      base,
    );
    expect(ranked[0]!.url).toContain('how-we-hire');
    expect(ranked[0]!.hiring).toBe(true);
  });

  it('ranks careers above about, and about above nothing', () => {
    const ranked = rankLinks([link(`${base}about/`, 'About us'), link(`${base}careers/`, 'Join us')], base);
    expect(ranked[0]!.url).toContain('careers');
  });

  it('pushes junk pages down', () => {
    const ranked = rankLinks(
      [link(`${base}privacy/`, 'Privacy policy'), link(`${base}jobs/`, 'Open roles')],
      base,
    );
    expect(ranked[0]!.url).toContain('jobs');
    expect(ranked.at(-1)!.url).toContain('privacy');
  });

  it('finds a hiring page at an unpredictable path', () => {
    // The brief: "GitLab and PostHog both publish detailed hiring processes at paths we
    // would never have predicted." So the ranker must key off meaning, not a path list.
    const ranked = rankLinks([link(`${base}handbook/engineering/interviewing/`, 'Interviewing')], base);
    expect(ranked[0]!.hiring).toBe(true);
  });

  it('deduplicates the same URL appearing twice', () => {
    const ranked = rankLinks([link(`${base}careers/`, 'Careers', true), link(`${base}careers/`, 'Jobs')], base);
    expect(ranked).toHaveLength(1);
  });
});

describe('resolveCompanyName — owner of the required source.company field', () => {
  it('prefers og:site_name', () => {
    expect(resolveCompanyName({ siteName: 'Acme Freight', title: 'Careers | Acme', url: 'https://acme.test' })).toBe(
      'Acme Freight',
    );
  });

  it('strips a tagline from the title', () => {
    expect(resolveCompanyName({ title: 'Acme — port logistics software', url: 'https://acme.test' })).toBe('Acme');
  });

  it('ignores a title that is only a page name', () => {
    expect(resolveCompanyName({ title: 'Careers', companyFromJd: 'Acme Freight', url: 'https://x.test' })).toBe(
      'Acme Freight',
    );
  });

  it('falls back to the JD when the site gave nothing', () => {
    expect(resolveCompanyName({ companyFromJd: 'Northwind', url: 'https://x.test' })).toBe('Northwind');
  });

  it('uses the hostname label as a last resort', () => {
    expect(resolveCompanyName({ url: 'https://www.acme-freight.com/' })).toBe('Acme Freight');
  });

  /** Regression: an unreachable domain was title-cased into a plausible-looking company. */
  it('shows a long hostname verbatim rather than inventing a company name', () => {
    const name = resolveCompanyName({ url: 'http://this-domain-should-not-resolve-prepkit.invalid/' });
    expect(name).toBe('this-domain-should-not-resolve-prepkit.invalid');
    expect(name).not.toContain('This Domain Should');
  });

  it('never returns an empty string — source.company is required', () => {
    expect(resolveCompanyName({ url: 'not a url' })).toBeTruthy();
  });
});

describe('CAREERS pattern — real-world false positives found via live testing', () => {
  it('does not treat a "ci-jobs" URL SLUG as a hiring signal when the anchor text is unrelated', () => {
    // The real case, from GitLab's own handbook: the compound word lives in the URL path,
    // not the clickable text a person actually reads.
    const base = 'https://acme.test/';
    const link = (href: string, text: string) => ({ href, text, inNav: false });
    const ranked = rankLinks(
      [link(`${base}handbook/enterprise-data/platform/ci-jobs/`, 'CI/CD pipeline reference'), link(`${base}careers/`, 'Careers')],
      base,
    );
    expect(ranked[0]!.url).toContain('careers');
    // Note: "handbook" (a separate, PROCESS-pattern signal — many companies do host their
    // hiring process under a literal /handbook/ path) can still flag this true; that is a
    // different, inherent ambiguity unrelated to the jobs-slug fix this test targets. What
    // matters here is that the compound "jobs" slug no longer inflates its CAREERS score.
    const ciJobs = ranked.find((r) => r.url.includes('ci-jobs'))!;
    const careers = ranked.find((r) => r.url.endsWith('/careers/'))!;
    expect(ciJobs.score).toBeLessThan(careers.score);
  });

  it('DOES treat "Jobs" as a hiring signal when it is genuinely the anchor text', () => {
    const base = 'https://acme.test/';
    const link = (href: string, text: string) => ({ href, text, inNav: false });
    const ranked = rankLinks([link(`${base}opportunities/`, 'Open Jobs')], base);
    expect(ranked[0]!.score).toBeGreaterThan(0);
  });

  it('still treats a standalone "/jobs/" page as a hiring signal', () => {
    const base = 'https://acme.test/';
    const link = (href: string, text: string) => ({ href, text, inNav: false });
    const ranked = rankLinks([link(`${base}jobs/`, 'Open jobs')], base);
    expect(ranked[0]!.score).toBeGreaterThan(0);
  });
});

describe('job-posting ids — real-world false positives found via live testing', () => {
  it('scores an individual job posting (opaque id) far below a careers hub page', () => {
    const base = 'https://acme.test/';
    const link = (href: string, text: string) => ({ href, text, inNav: false });
    const ranked = rankLinks(
      [
        link(`${base}careers/`, 'Careers'),
        link(`${base}careers/fb4b6076-b943-4d95-bb9b-a66aef8275f2`, 'Senior Engineer'),
      ],
      base,
    );
    const hub = ranked.find((r) => r.url === `${base}careers/`)!;
    const posting = ranked.find((r) => r.url.includes('fb4b6076'))!;
    expect(hub.score).toBeGreaterThan(posting.score);
  });
});
