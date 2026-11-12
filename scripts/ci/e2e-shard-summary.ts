/**
 * Job summary of a sharded E2E run (e2e-tests.yml merge-report, release-e2e.yml merge job):
 * reads the JSON report that `playwright merge-reports --reporter=json` wrote from every
 * shard's blob and prints Markdown: the totals, then each spec file with its failed and
 * flaky tests and the projects they failed in. One place to read a run, whatever shard
 * a test ran in.
 *
 *   node --experimental-strip-types scripts/ci/e2e-shard-summary.ts results.json >> "$GITHUB_STEP_SUMMARY"
 */
import { readFileSync } from 'node:fs';

interface JsonResult { status: string; retry: number }
interface JsonTest { projectName: string; status: string; results: JsonResult[] }
interface JsonSpec { title: string; file: string; line: number; tests: JsonTest[] }
interface JsonSuite { title: string; file?: string; specs?: JsonSpec[]; suites?: JsonSuite[] }
interface JsonReport { suites: JsonSuite[]; stats?: { duration?: number } }

export interface Row { file: string; title: string; line: number; outcome: 'failed' | 'flaky'; projects: string[] }
export interface Summary { passed: number; failed: number; flaky: number; skipped: number; rows: Row[] }

function walk(suite: JsonSuite, path: string[], visit: (spec: JsonSpec, path: string[]) => void): void {
  const here = suite.file && suite.title === suite.file ? path : [...path, suite.title];
  for (const spec of suite.specs ?? []) visit(spec, here);
  for (const child of suite.suites ?? []) walk(child, here, visit);
}

export function summarise(report: JsonReport): Summary {
  const summary: Summary = { passed: 0, failed: 0, flaky: 0, skipped: 0, rows: [] };
  const rows = new Map<string, Row>();
  for (const top of report.suites ?? []) {
    walk(top, [], (spec, path) => {
      for (const test of spec.tests) {
        // Playwright: expected (passed), unexpected (failed), flaky (passed on retry), skipped
        const outcome = test.status === 'unexpected' ? 'failed' : test.status === 'flaky' ? 'flaky' : test.status === 'skipped' ? 'skipped' : 'passed';
        summary[outcome]++;
        if (outcome !== 'failed' && outcome !== 'flaky') continue;
        const title = [...path.filter(Boolean), spec.title].join(' › ');
        const key = `${outcome}|${spec.file}|${spec.line}|${title}`;
        const row = rows.get(key) ?? { file: spec.file, title, line: spec.line, outcome, projects: [] };
        if (!row.projects.includes(test.projectName)) row.projects.push(test.projectName);
        rows.set(key, row);
      }
    });
  }
  summary.rows = [...rows.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.outcome.localeCompare(b.outcome));
  return summary;
}

export function markdown(summary: Summary, heading = 'E2E results (all shards)'): string {
  const out = [`### ${heading}`, '', `${summary.passed} passed, ${summary.failed} failed, ${summary.flaky} flaky, ${summary.skipped} skipped`, ''];
  const byFile = new Map<string, Row[]>();
  for (const row of summary.rows) byFile.set(row.file, [...(byFile.get(row.file) ?? []), row]);
  if (!byFile.size) out.push('No failed or flaky tests.');
  for (const [file, rows] of byFile) {
    out.push(`**${file}**`);
    for (const row of rows) out.push(`- ${row.outcome === 'failed' ? '❌ failed' : '⚠️ flaky'} :${row.line} ${row.title} — ${row.projects.join(', ')}`);
    out.push('');
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, heading] = process.argv.slice(2);
  if (!file) {
    process.stderr.write('usage: e2e-shard-summary.ts <results.json> [heading]\n');
    process.exit(2);
  }
  process.stdout.write(markdown(summarise(JSON.parse(readFileSync(file, 'utf8')) as JsonReport), heading) + '\n');
}
