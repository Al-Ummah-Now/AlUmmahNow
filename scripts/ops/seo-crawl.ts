/**
 * Weekly production SEO crawl (wiki AUN-SEO, Monitoring 4; seo-crawl.yml). Read-only: GET requests
 * without JavaScript, cookies or credentials, about 200 pages plus the sitemaps, no AI.
 *
 * For each host it reads robots.txt (needs a Sitemap: line), the sitemap index and its sitemap files,
 * then samples pages from every <loc> (spread over the hosts and files, stable for a given day) and
 * checks what a search engine sees:
 *   - 200 straight away (a sitemap lists final URLs: a redirect or an error is a finding)
 *   - indexable: no noindex in X-Robots-Tag, exactly one robots meta and it does not say noindex
 *   - a non-empty <title> and meta description
 *   - exactly one canonical, absolute, equal to the page's own URL (D-SEO-1: every language URL is self-canonical)
 *   - every JSON-LD block parses; a VideoObject has name, description, thumbnailUrl, uploadDate, embedUrl
 *   - no signed media URL (token=, Expires=) in the HTML
 * Findings go to ONE issue (label seo-crawl): created or rewritten when there are any, closed when a
 * run is clean, the same way as scripts/ci/nightly-flaky-issue.ts.
 *
 * Usage: node --experimental-strip-types scripts/ops/seo-crawl.ts [--host <host>]... [--sample 200]
 *          [--run-url <url>] [--dry-run]
 * Env (not with --dry-run): GITHUB_TOKEN, GITHUB_REPOSITORY.
 */
import { pathToFileURL } from 'node:url';

export const LABEL = 'seo-crawl';
export const TITLE = 'Weekly SEO crawl: production pages with problems';
export const DEFAULT_HOSTS = ['videos.alummahnow.net', 'www.alummahnow.net'];
const USER_AGENT = 'AlUmmahNow-SEO-crawl/1.0 (+https://www.alummahnow.net; weekly read-only check)';
const MAX_SITEMAP_FILES = 30;
const CONCURRENCY = 4;

export interface Finding {
  url: string;
  problem: string;
}

type Fetcher = (url: string) => Promise<{ status: number; headers: Headers; text: string }>;

const defaultFetch: Fetcher = async (url) => {
  const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, headers: res.headers, text: res.status >= 300 && res.status < 400 ? '' : await res.text() };
};

// &amp; last, so an escaped entity (&amp;lt;) stays literal text instead of being decoded twice
const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

/** The <loc> values of a sitemap or sitemap index */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decode(m[1]));
}

/** Attributes of every tag `name` in the HTML head-ish part (no DOM: plain regexes, good enough for our own markup) */
function tags(html: string, name: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((m) => {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = decode(a[3] ?? a[4] ?? '');
    return attrs;
  });
}

const VIDEO_FIELDS = ['name', 'description', 'thumbnailUrl', 'uploadDate', 'embedUrl'] as const;

/** What is wrong with one page as a search engine sees it ([] = fine) */
export function checkPage(url: string, status: number, headers: Headers, html: string): string[] {
  if (status >= 300 && status < 400) return [`${status} redirect to ${headers.get('location') ?? '?'} (sitemaps must list final URLs)`];
  if (status !== 200) return [`HTTP ${status}`];
  const problems: string[] = [];
  if (/noindex/i.test(headers.get('x-robots-tag') ?? '')) problems.push(`X-Robots-Tag: ${headers.get('x-robots-tag')}`);
  const metas = tags(html, 'meta');
  const robots = metas.filter((m) => m.name?.toLowerCase() === 'robots');
  if (robots.length !== 1) problems.push(`${robots.length} robots meta tags (expected 1)`);
  if (robots.some((m) => /noindex/i.test(m.content ?? ''))) problems.push('robots meta says noindex');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  if (!title) problems.push('empty or missing <title>');
  const description = metas.find((m) => m.name?.toLowerCase() === 'description')?.content?.trim();
  if (!description) problems.push('empty or missing meta description');
  const canonicals = tags(html, 'link').filter((l) => l.rel?.toLowerCase() === 'canonical');
  if (canonicals.length !== 1) problems.push(`${canonicals.length} canonical links (expected 1)`);
  else if (canonicals[0].href !== url) problems.push(`canonical is ${canonicals[0].href || '(empty)'}, not the page itself`);
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      problems.push('a JSON-LD block does not parse');
      continue;
    }
    for (const item of [data].flat(2) as Array<Record<string, unknown> | null>) {
      if (item?.['@type'] !== 'VideoObject') continue;
      const missing = VIDEO_FIELDS.filter((f) => item[f] == null || item[f] === '');
      if (missing.length) problems.push(`VideoObject without ${missing.join(', ')}`);
    }
  }
  if (/[?&](token|Expires|X-Amz-Signature)=/i.test(html.replace(/&amp;/g, '&'))) problems.push('signed media URL in the HTML');
  return problems;
}

/** A small seeded PRNG (mulberry32), so a day's sample is reproducible */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Up to `n` URLs, round-robin over the groups (one per host and sitemap file) so a small file is not
 * drowned by a big one, each group shuffled with the seed.
 */
export function sample(groups: string[][], n: number, seed: number): string[] {
  const rnd = random(seed);
  const queues = groups.map((g) => {
    const q = [...new Set(g)];
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    return q;
  });
  const out: string[] = [];
  const seen = new Set<string>();
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && !seen.has(next) && out.length < n) {
        seen.add(next);
        out.push(next);
      }
    }
  }
  return out;
}

export async function crawl(hosts: string[], n: number, seed: number, get: Fetcher = defaultFetch): Promise<{ checked: number; findings: Finding[] }> {
  const findings: Finding[] = [];
  const groups: string[][] = [];
  for (const host of hosts) {
    const origin = `https://${host}`;
    const robots = await get(`${origin}/robots.txt`).catch(() => null);
    const sitemapLine = robots?.status === 200 ? /^sitemap:\s*(\S+)/im.exec(robots.text)?.[1] : undefined;
    if (!sitemapLine) findings.push({ url: `${origin}/robots.txt`, problem: robots ? `no Sitemap: line (HTTP ${robots.status})` : 'unreachable' });
    const indexUrl = sitemapLine ?? `${origin}/sitemap.xml`;
    const index = await get(indexUrl).catch(() => null);
    if (index?.status !== 200) {
      findings.push({ url: indexUrl, problem: index ? `sitemap HTTP ${index.status}` : 'sitemap unreachable' });
      continue;
    }
    const isIndex = /<sitemapindex\b/i.test(index.text);
    const files = isIndex ? sitemapLocs(index.text) : [indexUrl];
    if (!files.length) findings.push({ url: indexUrl, problem: 'empty sitemap index' });
    if (!isIndex) groups.push(sitemapLocs(index.text));
    else {
      for (const file of files.slice(0, MAX_SITEMAP_FILES)) {
        const res = await get(file).catch(() => null);
        if (res?.status !== 200) findings.push({ url: file, problem: res ? `sitemap file HTTP ${res.status}` : 'sitemap file unreachable' });
        else groups.push(sitemapLocs(res.text));
      }
    }
  }
  const urls = sample(groups, n, seed);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < urls.length) {
        const url = urls[next++];
        try {
          const res = await get(url);
          for (const problem of checkPage(url, res.status, res.headers, res.text)) findings.push({ url, problem });
        } catch (error) {
          findings.push({ url, problem: `request failed: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
    }),
  );
  findings.sort((a, b) => a.url.localeCompare(b.url) || a.problem.localeCompare(b.problem));
  return { checked: urls.length, findings };
}

const cell = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function issueBody(findings: Finding[], checked: number, hosts: string[], runUrl: string, date: string): string {
  const shown = findings.slice(0, 200);
  return [
    `The weekly read-only crawl of production (${date}, [run](${runUrl})) sampled ${checked} pages from the sitemaps of ${hosts.join(', ')} and found ${findings.length} problem${findings.length === 1 ? '' : 's'}.`,
    '',
    'Each row is something a search engine sees on that page (wiki AUN-SEO, Monitoring). Fix the page or the sitemap; the issue closes itself after a clean run.',
    '',
    '| Page | Problem |',
    '|---|---|',
    ...shown.map((f) => `| ${cell(f.url)} | ${cell(f.problem)} |`),
    ...(findings.length > shown.length ? ['', `…and ${findings.length - shown.length} more (see the run log).`] : []),
    '',
    'This body is rewritten by every run (scripts/ops/seo-crawl.ts); discussion goes in comments.',
  ].join('\n');
}

async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'aun-seo-crawl' },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function main(argv: string[]): Promise<number> {
  const hosts: string[] = [];
  let n = 200;
  let runUrl = '';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--host') hosts.push(argv[++i]);
    else if (argv[i] === '--sample') n = Number(argv[++i]);
    else if (argv[i] === '--run-url') runUrl = argv[++i];
    else if (argv[i] === '--dry-run') dryRun = true;
  }
  const targets = hosts.length ? hosts : DEFAULT_HOSTS;
  const date = new Date().toISOString().slice(0, 10);
  const { checked, findings } = await crawl(targets, Number.isFinite(n) && n > 0 ? n : 200, Number(date.replace(/-/g, '')));
  process.stdout.write(`Checked ${checked} pages on ${targets.join(', ')}: ${findings.length} problems\n`);
  for (const f of findings) process.stdout.write(`  ${f.url}: ${f.problem}\n`);
  if (dryRun) return findings.length ? 1 : 0;

  const open = (await (await gh(`/issues?state=open&labels=${LABEL}&per_page=10`)).json()) as Array<{ number: number; pull_request?: unknown }>;
  const issue = open.find((i) => !i.pull_request);
  if (!findings.length) {
    if (issue) {
      await gh(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `${date}: ${checked} pages checked, no problems ([run](${runUrl})). Closing.` }) });
      await gh(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
      process.stdout.write(`Closed #${issue.number}\n`);
    }
    return 0;
  }
  const body = issueBody(findings, checked, targets, runUrl, date);
  if (issue) {
    await gh(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    await gh(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `${date}: ${findings.length} problems in ${checked} pages ([run](${runUrl})).` }) });
    process.stdout.write(`Updated #${issue.number}\n`);
  } else {
    const created = (await (await gh('/issues', { method: 'POST', body: JSON.stringify({ title: TITLE, body, labels: [LABEL] }) })).json()) as { number: number };
    process.stdout.write(`Opened #${created.number}\n`);
  }
  // The issue is the report: the job itself stays green so a finding is not mistaken for a broken workflow
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exit(1);
    },
  );
}
