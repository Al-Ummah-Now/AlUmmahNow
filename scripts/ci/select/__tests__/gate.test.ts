/**
 * The Local E2E gate and the shadow report, on synthetic `needs` and GraphQL pages.
 * Run: pnpm test:scripts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate, gateSummary, type NeedResult } from '../gate.ts';
import { buildReport, collect, markdown, parsePlanAnnotation, suiteOfCheck, type CommitRuns } from '../shadow-report.ts';

const GATE = fileURLToPath(new URL('../gate.ts', import.meta.url));

function plan(jobs: Record<string, boolean>, mode: 'all' | 'selected' = 'selected'): string {
  return JSON.stringify({ mode, reason: 'test', suites: {}, jobs, why: {}, files: 1 });
}

function needs(planJson: string | undefined, results: Record<string, string>, selectResult = 'success'): Record<string, NeedResult> {
  const out: Record<string, NeedResult> = { select: { result: selectResult, outputs: planJson ? { plan: planJson } : {} } };
  for (const [job, result] of Object.entries(results)) out[job] = { result, outputs: {} };
  return out;
}

const ADMIN_ONLY = plan({ build: true, web: false, admin: true, release: true });

describe('gate', () => {
  it('passes when selected jobs pass and unselected ones are skipped', () => {
    const g = gate(needs(ADMIN_ONLY, { build: 'success', web: 'skipped', admin: 'success', release: 'success' }));
    assert.equal(g.ok, true);
    assert.deepEqual(g.problems, []);
  });

  it('fails when a selected job was skipped', () => {
    const g = gate(needs(ADMIN_ONLY, { build: 'success', web: 'skipped', admin: 'skipped', release: 'success' }));
    assert.equal(g.ok, false);
    assert.deepEqual(g.problems, ['admin: skipped but selected']);
  });

  it('fails on a failed or cancelled job, selected or not', () => {
    assert.deepEqual(gate(needs(ADMIN_ONLY, { build: 'success', web: 'success', admin: 'failure', release: 'success' })).problems, ['admin: failure']);
    assert.deepEqual(gate(needs(ADMIN_ONLY, { build: 'success', web: 'cancelled', admin: 'success', release: 'success' })).problems, ['web: cancelled']);
  });

  it('records a miss: a job the selector would skip that failed (shadow mode runs it anyway)', () => {
    const g = gate(needs(ADMIN_ONLY, { build: 'success', web: 'failure', admin: 'success', release: 'success' }));
    assert.deepEqual(g.audit.filter((r) => r.miss).map((r) => r.job), ['web']);
    assert.equal(g.ok, false);
    assert.match(gateSummary(g, 'shadow'), /1 miss\(es\)\*\*: the selector would have skipped web/);
  });

  it('a failure of a selected job is not a miss', () => {
    const g = gate(needs(ADMIN_ONLY, { build: 'success', web: 'success', admin: 'failure', release: 'success' }));
    assert.deepEqual(g.audit.filter((r) => r.miss), []);
  });

  it('with no plan (select failed or its output is broken) every job counts as selected', () => {
    for (const [p, selectResult] of [[undefined, 'failure'], ['{not json', 'success'], [JSON.stringify({ mode: 'weird' }), 'success']] as const) {
      const g = gate(needs(p, { build: 'success', web: 'skipped', admin: 'success', release: 'success' }, selectResult));
      assert.equal(g.planMode, 'missing');
      assert.deepEqual(g.problems, ['web: skipped but selected']);
    }
  });

  it('a select failure alone does not fail the gate when every job ran', () => {
    const g = gate(needs(undefined, { build: 'success', web: 'success', admin: 'success', release: 'success' }, 'failure'));
    assert.equal(g.ok, true);
    assert.match(g.reason, /no plan from the select job \(failure\)/);
  });

  it('plan "all" selects every job, and a job the plan does not name counts as selected', () => {
    assert.deepEqual(gate(needs(plan({}, 'all'), { web: 'skipped' })).problems, ['web: skipped but selected']);
    assert.deepEqual(gate(needs(ADMIN_ONLY, { 'new-job': 'skipped' })).problems, ['new-job: skipped but selected']);
  });

  it('the CLI exits 1 on a failed gate, writes the audit and annotates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-'));
    try {
      const out = join(dir, 'audit.json');
      const env = { ...process.env, GITHUB_STEP_SUMMARY: '', NEEDS: JSON.stringify(needs(ADMIN_ONLY, { build: 'success', web: 'failure', admin: 'success', release: 'success' })) };
      let code = 0;
      let stdout = '';
      try {
        stdout = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', GATE, '--out', out], { env, encoding: 'utf8' });
      } catch (error) {
        code = (error as { status: number }).status;
        stdout = (error as { stdout: string }).stdout;
      }
      assert.equal(code, 1);
      assert.match(stdout, /::notice title=selection-audit::\{"p":"selected","j":\[\["build",1,"success"\],\["web",0,"failure"\]/);
      assert.match(stdout, /::error::web: failure/);
      const audit = JSON.parse(readFileSync(out, 'utf8')) as { mode: string; audit: Array<{ job: string; miss: boolean }> };
      assert.equal(audit.mode, 'shadow');
      assert.deepEqual(audit.audit.filter((r) => r.miss).map((r) => r.job), ['web']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('shadow report', () => {
  const t = (min: number) => new Date(Date.UTC(2026, 10, 16, 10, min)).toISOString();
  const run = (name: string, conclusion: string, start: number, end: number) => ({ name, conclusion, startedAt: t(start), completedAt: t(end) });

  it('maps check names to suites', () => {
    assert.equal(suiteOfCheck('Local web suite - 4/5'), 'web');
    assert.equal(suiteOfCheck('Local admin suite - chromium 1/2'), 'admin');
    assert.equal(suiteOfCheck('Local release suite - firefox'), 'release');
    assert.equal(suiteOfCheck('Player E2E - firefox'), 'player');
    assert.equal(suiteOfCheck('Build local stack'), 'build');
    assert.equal(suiteOfCheck('CI gate'), undefined);
    assert.equal(suiteOfCheck('Test selection'), undefined);
  });

  it('reads the plan annotation and refuses junk', () => {
    assert.deepEqual(parsePlanAnnotation('{"m":"selected","s":["admin"],"r":"x"}'), { mode: 'selected', suites: ['admin'], reason: 'x' });
    assert.equal(parsePlanAnnotation('nope'), undefined);
    assert.equal(parsePlanAnnotation('{"m":"some","s":[]}'), undefined);
  });

  const commits: CommitRuns[] = [
    {
      pr: 1, title: 'admin', oid: 'aaaaaaaaaaaa', date: t(0),
      plan: { mode: 'selected', suites: ['admin', 'release'], reason: 'selected: admin, release' },
      runs: [run('Build local stack', 'SUCCESS', 0, 3), run('Local web suite - 1/5', 'FAILURE', 3, 33), run('Local web suite - 2/5', 'SUCCESS', 3, 23), run('Local admin suite - mobile', 'SUCCESS', 3, 13), run('Player E2E - firefox', 'FAILURE', 0, 10), run('CI gate', 'FAILURE', 40, 41)],
    },
    { pr: 2, title: 'lockfile', oid: 'bbbbbbbbbbbb', date: t(0), plan: { mode: 'all', suites: ['web', 'admin', 'release', 'player'], reason: 'global input' }, runs: [run('Local web suite - 1/5', 'FAILURE', 0, 20)] },
    { pr: 3, title: 'before selection', oid: 'cccccccccccc', date: t(0), runs: [run('Local web suite - 1/5', 'SUCCESS', 0, 20)] },
  ];

  it('counts would-skip jobs and minutes, and lists misses with the main flake signal', () => {
    const r = buildReport(commits, new Map([['Player E2E - firefox', [Date.parse(t(30))]]]));
    assert.equal(r.withPlan, 2);
    assert.equal(r.selected, 1);
    assert.equal(r.all, 1);
    assert.equal(r.jobsWouldSkip, 3);
    assert.equal(r.minutesWouldSkip, 60);
    assert.deepEqual(r.misses.map((m) => [m.pr, m.job, m.failedOnMainSameDay]), [[1, 'Local web suite - 1/5', false], [1, 'Player E2E - firefox', true]]);
    const md = markdown(r);
    assert.match(md, /Would skip 3 of 6 E2E jobs, 60 of \d+ runner-minutes/);
    assert.match(md, /\| #1 \| aaaaaaaaa \| Local web suite - 1\/5 \| \*\*no: check the graph\*\* \|/);
    assert.match(md, /yes \(flake signal\)/);
  });

  it('collects plans and runs from GraphQL pages, PR runs of Local E2E and Player E2E only', () => {
    const suite = (workflow: string, event: string, runs: object[], annotation?: string) => ({
      workflowRun: { event, workflow: { name: workflow } },
      sel: { nodes: annotation ? [{ annotations: { nodes: [{ title: 'test-selection-plan', message: annotation }] } }] : [] },
      runs: { nodes: runs },
    });
    const page = (prs: object[], hasNextPage: boolean) => ({ data: { repository: { pullRequests: { pageInfo: { hasNextPage, endCursor: 'c' }, nodes: prs } } } });
    const pr = (n: number, suites: object[]) => ({ number: n, title: `pr ${n}`, updatedAt: t(0), commits: { nodes: [{ commit: { oid: `oid${n}`, committedDate: t(0), checkSuites: { nodes: suites } } }] } });
    const pages = [
      page([pr(10, [suite('Local E2E', 'pull_request', [run('Local web suite - 1/5', 'SUCCESS', 0, 5)], '{"m":"selected","s":["web"],"r":"r"}'), suite('Deploy', 'pull_request', [run('test', 'SUCCESS', 0, 1)])])], true),
      page([pr(11, [suite('Local E2E', 'push', [run('Local web suite - 1/5', 'SUCCESS', 0, 5)])])], false),
    ];
    const calls: Array<Record<string, string | number>> = [];
    const out = collect((_q, vars) => { calls.push(vars); return pages[calls.length - 1]; }, 'o', 'n', 20);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].after, 'c');
    assert.deepEqual(out.map((c) => [c.pr, c.plan?.suites, c.runs.length]), [[10, ['web'], 1]]);
  });
});
