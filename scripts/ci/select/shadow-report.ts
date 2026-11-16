/**
 * Shadow-mode report: for recent pull-request runs, what test selection would have skipped, what that
 * saves, and every "miss" (a job it would have skipped that failed). The exit bar for enforcing
 * selection is zero real misses.
 *
 *   node --experimental-strip-types scripts/ci/select/shadow-report.ts [--prs 40] [--since 2026-11-16]
 *     [--repo Al-Ummah-Now/AlUmmahNow] [--json out.json]
 *
 * GraphQL only (`gh api graphql`), one query per page of pull requests, so it stays off the shared REST
 * quota. The plan of each run comes from the `test-selection-plan` annotation of its "Test selection"
 * check; job results come from the Local E2E and Player E2E check suites of the same commit. For each
 * miss it also says whether the same job failed on main within a day (a flake signal, not a graph gap).
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_JOB, SUITES } from './graph.ts';

export const SELECT_CHECK = 'Test selection';
const WORKFLOWS = ['Local E2E', 'Player E2E'];

export interface CheckRun {
  name: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunPlan {
  mode: 'all' | 'selected';
  suites: string[];
  reason: string;
}

export interface CommitRuns {
  pr: number;
  title: string;
  oid: string;
  date: string;
  plan?: RunPlan;
  runs: CheckRun[];
}

export interface Miss {
  pr: number;
  oid: string;
  job: string;
  suite: string;
  failedOnMainSameDay: boolean;
}

export interface Report {
  commits: number;
  withPlan: number;
  all: number;
  selected: number;
  jobsRun: number;
  jobsWouldSkip: number;
  minutesRun: number;
  minutesWouldSkip: number;
  misses: Miss[];
  rows: Array<{ pr: number; oid: string; mode: string; suites: string; skipJobs: number; skipMinutes: number; reason: string }>;
}

/** The suite a check-run name belongs to ("Local web suite - 1/5" → web), or undefined. */
export function suiteOfCheck(name: string): string | undefined {
  if (name.startsWith(BUILD_JOB.checkPrefix)) return BUILD_JOB.job;
  for (const [id, suite] of Object.entries(SUITES)) if (name.startsWith(suite.checkPrefix)) return id;
  return undefined;
}

export function parsePlanAnnotation(message: string): RunPlan | undefined {
  try {
    const p = JSON.parse(message) as { m?: string; s?: unknown; r?: string };
    if ((p.m !== 'all' && p.m !== 'selected') || !Array.isArray(p.s)) return undefined;
    return { mode: p.m, suites: p.s.map(String), reason: p.r ?? '' };
  } catch {
    return undefined;
  }
}

function selectedSuite(plan: RunPlan, suite: string): boolean {
  if (plan.mode === 'all') return true;
  if (suite === BUILD_JOB.job) return BUILD_JOB.for.some((s) => plan.suites.includes(s));
  return plan.suites.includes(suite);
}

function minutes(run: CheckRun): number {
  if (!run.startedAt || !run.completedAt) return 0;
  return Math.max(0, (Date.parse(run.completedAt) - Date.parse(run.startedAt)) / 60000);
}

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE']);

/** Whole report from collected commits; `mainFailures` maps a check name to the times it failed on main. */
export function buildReport(commits: CommitRuns[], mainFailures: Map<string, number[]>): Report {
  const report: Report = { commits: commits.length, withPlan: 0, all: 0, selected: 0, jobsRun: 0, jobsWouldSkip: 0, minutesRun: 0, minutesWouldSkip: 0, misses: [], rows: [] };
  for (const c of commits) {
    if (!c.plan) continue;
    report.withPlan++;
    if (c.plan.mode === 'all') report.all++;
    else report.selected++;
    let skipJobs = 0;
    let skipMinutes = 0;
    for (const run of c.runs) {
      const suite = suiteOfCheck(run.name);
      if (!suite) continue;
      const m = minutes(run);
      report.jobsRun++;
      report.minutesRun += m;
      if (selectedSuite(c.plan, suite)) continue;
      skipJobs++;
      skipMinutes += m;
      if (run.conclusion && FAILED.has(run.conclusion)) {
        const at = Date.parse(run.completedAt ?? c.date);
        const onMain = (mainFailures.get(run.name) ?? []).some((t) => Math.abs(t - at) <= 24 * 3600 * 1000);
        report.misses.push({ pr: c.pr, oid: c.oid, job: run.name, suite, failedOnMainSameDay: onMain });
      }
    }
    report.jobsWouldSkip += skipJobs;
    report.minutesWouldSkip += skipMinutes;
    report.rows.push({ pr: c.pr, oid: c.oid.slice(0, 9), mode: c.plan.mode, suites: c.plan.mode === 'all' ? 'all' : c.plan.suites.join(', ') || 'none', skipJobs, skipMinutes: Math.round(skipMinutes), reason: c.plan.reason });
  }
  report.minutesRun = Math.round(report.minutesRun);
  report.minutesWouldSkip = Math.round(report.minutesWouldSkip);
  return report;
}

export function markdown(r: Report): string {
  const lines = [
    '## Test selection: shadow report',
    '',
    `${r.withPlan} PR run(s) with a plan (of ${r.commits} commits looked at): ${r.selected} selected, ${r.all} ran everything.`,
    `Would skip ${r.jobsWouldSkip} of ${r.jobsRun} E2E jobs, ${r.minutesWouldSkip} of ${r.minutesRun} runner-minutes.`,
    '',
    `### Misses: ${r.misses.length}`,
    '',
  ];
  if (r.misses.length) {
    lines.push('| PR | Commit | Job | Failed on main within a day |', '|---|---|---|---|');
    for (const m of r.misses) lines.push(`| #${m.pr} | ${m.oid.slice(0, 9)} | ${m.job} | ${m.failedOnMainSameDay ? 'yes (flake signal)' : '**no: check the graph**'} |`);
  } else {
    lines.push('None.');
  }
  lines.push('', '### Runs', '', '| PR | Commit | Plan | Suites | Skip jobs | Skip min | Reason |', '|---|---|---|---|---|---|---|');
  for (const row of r.rows) lines.push(`| #${row.pr} | ${row.oid} | ${row.mode} | ${row.suites} | ${row.skipJobs} | ${row.skipMinutes} | ${row.reason.replace(/[\\|]/g, (c) => `\\${c}`)} |`);
  return `${lines.join('\n')}\n`;
}

// ---- GitHub (GraphQL) ----

type GraphQL = (query: string, vars: Record<string, string | number>) => unknown;

export function ghGraphQL(query: string, vars: Record<string, string | number>): unknown {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`);
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

const RUN_FIELDS = 'name conclusion startedAt completedAt';
const PRS_QUERY = `query($owner:String!,$name:String!,$n:Int!,$after:String){repository(owner:$owner,name:$name){
pullRequests(first:$n,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}
nodes{number title updatedAt commits(last:10){nodes{commit{oid committedDate
checkSuites(first:25){nodes{workflowRun{event workflow{name}}
sel:checkRuns(first:1,filterBy:{checkName:"${SELECT_CHECK}"}){nodes{annotations(first:10){nodes{title message}}}}
runs:checkRuns(first:40){nodes{${RUN_FIELDS}}}}}}}}}}}}`;
const MAIN_QUERY = `query($owner:String!,$name:String!,$since:GitTimestamp!){repository(owner:$owner,name:$name){
ref(qualifiedName:"refs/heads/main"){target{... on Commit{history(first:60,since:$since){nodes{
checkSuites(first:25){nodes{workflowRun{workflow{name}} checkRuns(first:40,filterBy:{conclusions:[FAILURE,TIMED_OUT]}){nodes{${RUN_FIELDS}}}}}}}}}}}}`;

interface SuiteNode {
  workflowRun: { event: string; workflow: { name: string } } | null;
  sel?: { nodes: Array<{ annotations: { nodes: Array<{ title: string | null; message: string }> } }> };
  runs?: { nodes: CheckRun[] };
  checkRuns?: { nodes: CheckRun[] };
}

export function collect(gql: GraphQL, owner: string, name: string, prs: number, since?: string): CommitRuns[] {
  const out: CommitRuns[] = [];
  let after: string | undefined;
  let seen = 0;
  while (seen < prs) {
    const vars: Record<string, string | number> = { owner, name, n: Math.min(10, prs - seen) };
    if (after) vars.after = after;
    const data = gql(PRS_QUERY, vars) as { data: { repository: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Array<{ number: number; title: string; updatedAt: string; commits: { nodes: Array<{ commit: { oid: string; committedDate: string; checkSuites: { nodes: SuiteNode[] } } }> } }> } } } };
    const page = data.data.repository.pullRequests;
    for (const pr of page.nodes) {
      seen++;
      if (since && pr.updatedAt < since) continue;
      for (const { commit } of pr.commits.nodes) {
        const suites = commit.checkSuites.nodes.filter((s) => s.workflowRun?.event === 'pull_request' && WORKFLOWS.includes(s.workflowRun.workflow.name));
        if (!suites.length) continue;
        let plan: RunPlan | undefined;
        const runs: CheckRun[] = [];
        for (const s of suites) {
          for (const sel of s.sel?.nodes ?? []) {
            for (const a of sel.annotations.nodes) if (a.title === 'test-selection-plan') plan = parsePlanAnnotation(a.message) ?? plan;
          }
          runs.push(...(s.runs?.nodes ?? []));
        }
        out.push({ pr: pr.number, title: pr.title, oid: commit.oid, date: commit.committedDate, plan, runs });
      }
    }
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return out;
}

export function mainFailures(gql: GraphQL, owner: string, name: string, since: string): Map<string, number[]> {
  const data = gql(MAIN_QUERY, { owner, name, since }) as { data: { repository: { ref: { target: { history: { nodes: Array<{ checkSuites: { nodes: SuiteNode[] } }> } } } } } };
  const out = new Map<string, number[]>();
  for (const c of data.data.repository.ref.target.history.nodes) {
    for (const s of c.checkSuites.nodes) {
      for (const run of s.checkRuns?.nodes ?? []) {
        const list = out.get(run.name) ?? [];
        list.push(Date.parse(run.completedAt ?? run.startedAt ?? ''));
        out.set(run.name, list);
      }
    }
  }
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [owner, name] = (arg('repo') ?? 'Al-Ummah-Now/AlUmmahNow').split('/');
  const prs = Number(arg('prs') ?? 40);
  const since = arg('since');
  const commits = collect(ghGraphQL, owner, name, prs, since);
  let failures = new Map<string, number[]>();
  const report0 = buildReport(commits, failures);
  if (report0.misses.length) {
    const earliest = commits.reduce((min, c) => (c.date < min ? c.date : min), new Date().toISOString());
    failures = mainFailures(ghGraphQL, owner, name, new Date(Date.parse(earliest) - 24 * 3600 * 1000).toISOString());
  }
  const report = report0.misses.length ? buildReport(commits, failures) : report0;
  const json = arg('json');
  if (json) writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(markdown(report));
}
