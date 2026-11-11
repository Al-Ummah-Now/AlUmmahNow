/**
 * Release suite reporter: what each test did, for people and for the nightly job.
 *
 * - Job summary (GITHUB_STEP_SUMMARY): every failed test and every FLAKY one (it
 *   failed, then passed on its one retry) with the first line of each failed
 *   attempt's error. A flaky test does not fail the run, but it is never silent:
 *   it is listed here and as a ::warning annotation.
 * - release-outcomes<suffix>.json next to the config: one row per test and
 *   repeat (title, project, file:line, outcome, attempts, error lines). The
 *   nightly job (release-e2e-nightly.yml) runs the suite 3 times and files an
 *   issue for any test that was not 3/3 (scripts/ci/nightly-flaky-issue.ts).
 *
 * Titles and error lines only: no step titles, no attachments (secret-safe; the
 * artifact scan still runs over everything).
 */
import { writeFileSync, appendFileSync } from 'fs';
import * as path from 'path';
import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

export interface OutcomeRow {
  /** project › file:line › title (stable across runs) */
  id: string;
  project: string;
  file: string;
  title: string;
  repeat: number;
  /** expected | flaky | unexpected | skipped */
  outcome: string;
  attempts: number;
  errors: string[];
}

const ANSI = /\x1b\[[0-9;]*m/g;

function firstLine(text: string | undefined): string {
  return (text ?? '').replace(ANSI, '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 300) ?? '';
}

function escapeCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export default class OutcomeReporter implements Reporter {
  private rootDir = '';
  private readonly tests: TestCase[] = [];
  private readonly results = new Map<TestCase, TestResult[]>();

  onBegin(config: FullConfig, suite: Suite): void {
    // The config's directory (the suite root in CI): paths and the outcomes file are relative to it
    this.rootDir = config.configFile ? path.dirname(config.configFile) : process.cwd();
    this.tests.push(...suite.allTests());
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const list = this.results.get(test) ?? [];
    list.push(result);
    this.results.set(test, list);
  }

  private rows(): OutcomeRow[] {
    return this.tests
      .filter((t) => this.results.has(t))
      .map((t) => {
        const project = t.parent.project()?.name ?? '';
        const file = `${path.relative(this.rootDir, t.location.file).split(path.sep).join('/')}:${t.location.line}`;
        const title = t.titlePath().slice(3).join(' › ');
        const results = this.results.get(t) ?? [];
        return {
          id: `[${project}] ${file} › ${title}`,
          project,
          file,
          title,
          repeat: t.repeatEachIndex,
          outcome: t.outcome(),
          attempts: results.length,
          errors: results.filter((r) => r.status !== 'passed' && r.status !== 'skipped').map((r) => firstLine(r.error?.message)),
        };
      });
  }

  onEnd(): void {
    const rows = this.rows();
    const suffix = /^[a-z0-9-]{1,32}$/.test(process.env.E2E_OUTPUT_SUFFIX ?? '') ? `-${process.env.E2E_OUTPUT_SUFFIX}` : '';
    writeFileSync(path.join(this.rootDir, `release-outcomes${suffix}.json`), JSON.stringify(rows, null, 1));

    const flaky = rows.filter((r) => r.outcome === 'flaky');
    const failed = rows.filter((r) => r.outcome === 'unexpected');
    for (const r of flaky) process.stdout.write(`::warning title=Flaky release spec::${r.id} failed, then passed on retry: ${r.errors[0] ?? ''}\n`);

    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryFile) return;
    const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
    const lines = [
      `### Release regressions${suffix ? ` (${suffix.slice(1)})` : ''}: ${counts.expected ?? 0} passed, ${failed.length} failed, ${flaky.length} flaky, ${counts.skipped ?? 0} skipped`,
      '',
    ];
    const table = (title: string, list: OutcomeRow[]) => {
      if (!list.length) return;
      lines.push(`**${title}**`, '', '| Test | Attempts | Errors |', '|---|---|---|');
      for (const r of list) lines.push(`| ${escapeCell(r.id)}${r.repeat ? ` (repeat ${r.repeat})` : ''} | ${r.attempts} | ${escapeCell(r.errors.join(' / '))} |`);
      lines.push('');
    };
    table('Failed', failed);
    table('Flaky (failed, then passed on retry: still a defect to fix)', flaky);
    appendFileSync(summaryFile, `${lines.join('\n')}\n`);
  }
}
