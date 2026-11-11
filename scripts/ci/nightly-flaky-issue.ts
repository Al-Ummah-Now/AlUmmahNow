/**
 * Nightly flake hunt (release-e2e-nightly.yml): the release suite runs with
 * --repeat-each 3 and no retries; this reads its outcome files
 * (apps/web/e2e/release/outcome-reporter.ts) and keeps ONE issue up to date
 * listing every test that was not 3/3.
 *
 * - Some test not 3/3: the open issue (label e2e-flaky-nightly) gets the new
 *   table as its body and a comment for tonight's run; none open, one is created.
 * - Everything 3/3: an open issue gets a comment and is closed.
 *
 * Each listed test must be fixed, or quarantined with "quarantined: #<issue>
 * @<owner>" (scripts/ci/check-quarantine.ts); nothing goes quiet otherwise.
 *
 * Usage: node --experimental-strip-types scripts/ci/nightly-flaky-issue.ts
 *          --repeat 3 --run-url <url> [--dry-run] <release-outcomes*.json>...
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/name).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface OutcomeRow {
  id: string;
  repeat: number;
  outcome: string;
  errors: string[];
}

export interface TestTally {
  id: string;
  passed: number;
  runs: number;
  errors: string[];
}

export const LABEL = 'e2e-flaky-nightly';
export const TITLE = 'Nightly release E2E: tests that are not 3/3';

/** Per test: how many of its repeats passed first time (a skip counts as a pass: nothing failed). */
export function tally(rows: OutcomeRow[], repeat: number): TestTally[] {
  const byId = new Map<string, TestTally>();
  for (const r of rows) {
    const t = byId.get(r.id) ?? { id: r.id, passed: 0, runs: 0, errors: [] };
    t.runs += 1;
    if (r.outcome === 'expected' || r.outcome === 'skipped') t.passed += 1;
    else for (const e of r.errors) if (e && !t.errors.includes(e) && t.errors.length < 3) t.errors.push(e);
    byId.set(r.id, t);
  }
  // A test that never reported for some repeat (the job died) counts that repeat as not passed
  return [...byId.values()]
    .map((t) => ({ ...t, runs: Math.max(t.runs, repeat) }))
    .filter((t) => t.passed < t.runs)
    .sort((a, b) => a.passed - b.passed || a.id.localeCompare(b.id));
}

const cell = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function issueBody(bad: TestTally[], runUrl: string, date: string): string {
  return [
    `Tests of the release suite (apps/web/e2e/release) that did not pass every time in the nightly run on QA (${date}, [run](${runUrl})): ${bad.length}.`,
    '',
    'Each run is the suite with `--repeat-each 3` and no retries. A test listed here is a defect (product or spec) until it is 3/3 again. Fix it, or quarantine it with `test.fixme(true, "quarantined: #<this issue> @<owner>")` (enforced by `scripts/ci/check-quarantine.ts`); never raise the retries.',
    '',
    '| Test | Passed | Errors |',
    '|---|---|---|',
    ...bad.map((t) => `| ${cell(t.id)} | ${t.passed}/${t.runs} | ${cell(t.errors.join(' / '))} |`),
    '',
    'This body is rewritten by every nightly run (scripts/ci/nightly-flaky-issue.ts); discussion goes in comments.',
  ].join('\n');
}

async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'aun-nightly-e2e',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function main(argv: string[]): Promise<number> {
  let repeat = 3;
  let runUrl = '';
  let dryRun = false;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repeat') repeat = Number(argv[++i]);
    else if (argv[i] === '--run-url') runUrl = argv[++i];
    else if (argv[i] === '--dry-run') dryRun = true;
    else files.push(argv[i]);
  }
  const present = files.filter((f) => existsSync(f));
  if (!present.length) {
    // No outcomes at all: the suite did not run. That is a failure to look at, not "all green".
    process.stdout.write('::error::No release-outcomes files: the nightly suite did not report\n');
    return 1;
  }
  const rows = present.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as OutcomeRow[]);
  const bad = tally(rows, repeat);
  const date = new Date().toISOString().slice(0, 10);
  process.stdout.write(`${rows.length} results, ${bad.length} tests not ${repeat}/${repeat}\n`);
  for (const t of bad) process.stdout.write(`  ${t.passed}/${t.runs} ${t.id}\n`);
  if (dryRun) {
    process.stdout.write(`${issueBody(bad, runUrl, date)}\n`);
    return 0;
  }

  const open = (await (await gh(`/issues?state=open&labels=${LABEL}&per_page=10`)).json()) as Array<{ number: number; pull_request?: unknown }>;
  const issue = open.find((i) => !i.pull_request);
  if (!bad.length) {
    if (issue) {
      await gh(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `${date}: every test was ${repeat}/${repeat} ([run](${runUrl})). Closing.` }) });
      await gh(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
      process.stdout.write(`Closed #${issue.number}\n`);
    }
    return 0;
  }
  const body = issueBody(bad, runUrl, date);
  if (issue) {
    await gh(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    await gh(`/issues/${issue.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: `${date}: ${bad.length} tests not ${repeat}/${repeat} ([run](${runUrl})): ${bad.map((t) => `${t.id} (${t.passed}/${t.runs})`).join('; ').slice(0, 60000)}` }),
    });
    process.stdout.write(`Updated #${issue.number}\n`);
  } else {
    const created = (await (await gh('/issues', { method: 'POST', body: JSON.stringify({ title: TITLE, body, labels: [LABEL] }) })).json()) as { number: number };
    process.stdout.write(`Created #${created.number}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e: unknown) => {
    process.stdout.write(`::error::${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
