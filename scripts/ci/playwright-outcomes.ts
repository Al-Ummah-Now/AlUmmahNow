/**
 * Per-test outcomes of a Playwright JSON report, for the job summary and a results artifact
 * (local-e2e.yml): a green job must still show which tests ran and which were skipped, and why.
 * A skipped test is not a pass.
 *
 *   node --experimental-strip-types scripts/ci/playwright-outcomes.ts <test-results.json> [heading]
 *
 * Prints Markdown: the totals, then every skipped test with its reason (annotations), then the
 * failed and flaky ones. With --list it also prints every test as "status<TAB>file:line<TAB>title".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

interface Annotation { type: string; description?: string }
interface Result { status: string }
interface JsonTest { projectName: string; status: string; annotations?: Annotation[]; results?: Result[] }
interface JsonSpec { title: string; file: string; line: number; tests: JsonTest[] }
interface JsonSuite { title: string; file?: string; specs?: JsonSpec[]; suites?: JsonSuite[] }
interface Report { suites?: JsonSuite[] }

export interface Outcome { status: 'passed' | 'failed' | 'flaky' | 'skipped'; file: string; line: number; title: string; project: string; reason: string }

function walk(suite: JsonSuite, path: string[], out: Outcome[]): void {
  const here = suite.file && suite.title === suite.file ? path : [...path, suite.title];
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      const status = t.status === 'expected' ? 'passed' : t.status === 'unexpected' ? 'failed' : t.status === 'flaky' ? 'flaky' : 'skipped';
      const reason = (t.annotations ?? []).filter((a) => /skip|fixme|fail/i.test(a.type)).map((a) => `${a.type}: ${a.description ?? ''}`.trim()).join('; ');
      out.push({ status, file: spec.file, line: spec.line, title: [...here.filter(Boolean), spec.title].join(' › '), project: t.projectName, reason });
    }
  }
  for (const child of suite.suites ?? []) walk(child, here, out);
}

export function outcomes(report: Report): Outcome[] {
  const out: Outcome[] = [];
  for (const s of report.suites ?? []) walk(s, [], out);
  return out;
}

export function markdown(list: Outcome[], heading: string): string {
  const count = (s: Outcome['status']) => list.filter((o) => o.status === s).length;
  const lines = [`### ${heading}`, '', `${count('passed')} passed, ${count('failed')} failed, ${count('flaky')} flaky, ${count('skipped')} skipped`, ''];
  for (const status of ['failed', 'flaky', 'skipped'] as const) {
    const rows = list.filter((o) => o.status === status);
    if (!rows.length) continue;
    lines.push(`**${status}**`);
    for (const o of rows) lines.push(`- ${o.file}:${o.line} ${o.title} [${o.project}]${o.reason ? ` — ${o.reason}` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => a !== '--list');
  const [file, heading = 'Test outcomes'] = args;
  if (!file) {
    process.stderr.write('usage: playwright-outcomes.ts <test-results.json> [heading] [--list]\n');
    process.exit(2);
  }
  const list = outcomes(JSON.parse(readFileSync(file, 'utf8')) as Report);
  process.stdout.write(markdown(list, heading) + '\n');
  if (process.argv.includes('--list')) for (const o of list) process.stdout.write(`${o.status}\t${o.file}:${o.line}\t${o.title} [${o.project}]\n`);
}
