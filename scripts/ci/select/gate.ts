/**
 * The Local E2E gate: one check that is green only when every job the plan selected passed.
 *
 *   NEEDS='${{ toJSON(needs) }}' SELECT_MODE=shadow \
 *     node --experimental-strip-types scripts/ci/select/gate.ts [--out selection-audit.json]
 *
 * Verdict per needed job (the `select` job's own `plan` output is the plan; a missing or broken plan
 * counts as "every job selected"):
 * - failure or cancelled → fail
 * - skipped and selected → fail (a suite the change can reach did not run)
 * - skipped and not selected → pass
 * - success → pass
 *
 * It also writes the audit (job, selected, result, miss) that shadow mode is for: a miss is a job the
 * selector would have skipped that failed. The audit goes to `--out`, the job summary and one
 * `::notice title=selection-audit::` annotation.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plan } from './core.ts';

export interface NeedResult {
  result: string;
  outputs?: Record<string, string>;
}

export interface AuditRow {
  job: string;
  selected: boolean;
  result: string;
  /** The selector would have skipped it, and it failed. */
  miss: boolean;
}

export interface GateResult {
  ok: boolean;
  planMode: 'all' | 'selected' | 'missing';
  reason: string;
  problems: string[];
  audit: AuditRow[];
}

export const SELECT_JOB = 'select';

export function readPlan(needs: Record<string, NeedResult>): Plan | undefined {
  const raw = needs[SELECT_JOB]?.outputs?.plan;
  if (!raw) return undefined;
  try {
    const plan = JSON.parse(raw) as Plan;
    if (plan.mode !== 'all' && plan.mode !== 'selected') return undefined;
    if (typeof plan.jobs !== 'object' || plan.jobs === null) return undefined;
    return plan;
  } catch {
    return undefined;
  }
}

export function gate(needs: Record<string, NeedResult>): GateResult {
  const plan = readPlan(needs);
  const problems: string[] = [];
  const audit: AuditRow[] = [];
  // The select job's own failure is not a problem by itself: with no plan every job counts as
  // selected, so a job it kept from running fails the gate as "skipped but selected"
  const selectResult = needs[SELECT_JOB]?.result;
  for (const [job, need] of Object.entries(needs)) {
    if (job === SELECT_JOB) continue;
    // A job the plan does not name (a new job) is treated as selected
    const selected = plan ? plan.mode === 'all' || plan.jobs[job] !== false : true;
    const result = need.result;
    audit.push({ job, selected, result, miss: !selected && result === 'failure' });
    if (result === 'failure' || result === 'cancelled') problems.push(`${job}: ${result}`);
    else if (result === 'skipped' && selected) problems.push(`${job}: skipped but selected`);
    else if (result !== 'success' && result !== 'skipped') problems.push(`${job}: ${result}`);
  }
  return {
    ok: problems.length === 0,
    planMode: plan ? plan.mode : 'missing',
    reason: plan ? plan.reason : `no plan from the select job (${selectResult ?? 'not run'}): every job counts as selected`,
    problems,
    audit,
  };
}

export function gateSummary(g: GateResult, mode: string): string {
  const lines = [
    `### CI gate: ${g.ok ? 'pass' : 'fail'}`,
    '',
    `Selection (${mode}): **${g.planMode}**, ${g.reason}`,
    '',
    '| Job | Selected | Result | Miss |',
    '|---|---|---|---|',
    ...g.audit.map((r) => `| ${r.job} | ${r.selected ? 'yes' : 'no'} | ${r.result} | ${r.miss ? '**miss**' : ''} |`),
  ];
  const misses = g.audit.filter((r) => r.miss);
  if (misses.length) {
    lines.push('', `**${misses.length} miss(es)**: the selector would have skipped ${misses.map((m) => m.job).join(', ')}, which failed. If the failure is real, the graph lacks an edge (scripts/ci/select/graph.ts).`);
  }
  if (g.problems.length) lines.push('', ...g.problems.map((p) => `- ${p}`));
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf('--out');
  const out = outIndex > 0 ? process.argv[outIndex + 1] : undefined;
  const mode = process.env.SELECT_MODE || 'shadow';
  let needs: Record<string, NeedResult> = {};
  try {
    needs = JSON.parse(process.env.NEEDS || '{}') as Record<string, NeedResult>;
  } catch (error) {
    process.stdout.write(`::error::NEEDS is not JSON: ${(error as Error).message}\n`);
    process.exit(1);
  }
  const g = gate(needs);
  const audit = { mode, ...g };
  if (out) writeFileSync(out, `${JSON.stringify(audit, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, gateSummary(g, mode));
  const compact = JSON.stringify({ p: g.planMode, j: g.audit.map((r) => [r.job, r.selected ? 1 : 0, r.result]) });
  process.stdout.write(`::notice title=selection-audit::${compact}\n`);
  for (const p of g.problems) process.stdout.write(`::error::${p}\n`);
  process.exit(g.ok ? 0 : 1);
}
