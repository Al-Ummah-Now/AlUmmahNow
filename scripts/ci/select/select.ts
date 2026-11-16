/**
 * Test selection for a CI run (wiki: "CI test selection").
 *
 *   node --experimental-strip-types scripts/ci/select/select.ts \
 *     --event pull_request --base <base sha> --head <head sha> [--labels a,b] [--out plan.json]
 *
 * Writes the plan as JSON (stdout, `--out`, and `plan=` in $GITHUB_OUTPUT), a "would run / would skip"
 * table to $GITHUB_STEP_SUMMARY, and one `::notice title=test-selection-plan::` annotation that the
 * shadow report reads back through GraphQL.
 *
 * It fails open: any event but pull_request, a `ci:full` label, an unmapped file, a global input, a
 * git error or any other error gives `mode: all`. It never exits non-zero for a selection problem.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adjacency, allEdges, planAll, readWorkspacePackage, selectFiles, workspaceEdges, type Plan } from './core.ts';
import { FULL_LABELS, PLACEMENT_FILE, SUITES } from './graph.ts';

export interface SelectArgs {
  event: string;
  base?: string;
  head?: string;
  labels: string[];
  root: string;
}

export type Git = (args: string[]) => string;

export function gitIn(root: string): Git {
  return (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function changedFiles(git: Git, base: string, head: string): { mergeBase: string; files: string[] } {
  const mergeBase = git(['merge-base', base, head]).trim();
  const files = git(['diff', '--name-only', '--no-renames', '-z', mergeBase, head]).split('\0').filter(Boolean);
  return { mergeBase, files };
}

/** The plan for one run. Never throws. */
export function plan(args: SelectArgs, git: Git = gitIn(args.root)): Plan {
  try {
    if (args.event !== 'pull_request') return planAll(`event ${args.event || '(none)'}: every suite runs`);
    const label = args.labels.find((l) => FULL_LABELS.includes(l));
    if (label) return planAll(`label ${label}`);
    if (!args.base || !args.head) return planAll('no base or head commit given');
    const { mergeBase, files } = changedFiles(git, args.base, args.head);
    const adj = adjacency(allEdges(workspaceEdges(readWorkspacePackage(args.root))));
    return selectFiles({
      files,
      adj,
      placement: () => ({
        base: git(['show', `${mergeBase}:${PLACEMENT_FILE}`]),
        head: git(['show', `${args.head}:${PLACEMENT_FILE}`]),
      }),
    });
  } catch (error) {
    return planAll(`selector error: ${(error as Error).message.split('\n')[0]}`);
  }
}

export function summary(p: Plan, mode: string): string {
  const lines = [
    `### Test selection (${mode === 'enforce' ? 'enforced' : 'shadow: every suite still runs'})`,
    '',
    `**${p.mode === 'all' ? 'Run all' : 'Selected'}**: ${p.reason} (${p.files} changed file${p.files === 1 ? '' : 's'})`,
    '',
    '| Suite | Would | Why |',
    '|---|---|---|',
  ];
  for (const [id, suite] of Object.entries(SUITES)) {
    const run = p.suites[id];
    const why = p.mode === 'all' ? p.reason : run ? (p.why[id] ?? '') : 'no changed file reaches it';
    lines.push(`| ${suite.name} | ${run ? 'run' : '**skip**'} | ${why.replace(/\|/g, '\\|')} |`);
  }
  return `${lines.join('\n')}\n`;
}

/** The compact plan the shadow report reads from the annotation. */
export function annotation(p: Plan): string {
  const selected = Object.keys(p.suites).filter((s) => p.suites[s]);
  const message = JSON.stringify({ m: p.mode, s: selected, r: p.reason.slice(0, 300) });
  // Workflow command data: % and newlines are escaped
  return `::notice title=test-selection-plan::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1] ?? '';
      i++;
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const p = plan({ event: a.event ?? '', base: a.base, head: a.head, labels: (a.labels ?? '').split(',').map((s) => s.trim()).filter(Boolean), root });
  const json = JSON.stringify(p);
  process.stdout.write(`${JSON.stringify(p, null, 2)}\n`);
  if (a.out) writeFileSync(a.out, `${JSON.stringify(p, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `plan=${json}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(p, process.env.SELECT_MODE ?? 'shadow'));
  if (process.env.GITHUB_ACTIONS) process.stdout.write(`${annotation(p)}\n`);
}
