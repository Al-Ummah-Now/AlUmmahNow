/**
 * Every API error answer goes through the worker's `apiError(c, status, code, extra)` helper
 * (apps/api-videos/src/lib/api-error.ts, apps/admin-api/src/lib/api-error.ts; wiki AUN-FEATURES
 * §5.2, FEAT-3), so its code comes from the shared catalogue and its message is the envelope's.
 *
 * Fails on a hand-written `success: false` in api-videos or admin-api source. The error envelope
 * middleware still completes the old bodies, so nothing users see depends on this; it keeps new
 * code on the helper and lets old files move as they are touched.
 *
 * A line that isn't an HTTP error body (a result object, a queue message) can say so with an
 * `error-body: not-http` comment on it or the line before.
 *
 * Files not moved yet are listed in error-bodies-baseline.txt with their count. A count can't
 * grow; when it shrinks, the baseline has to be updated in the same change (run with --write).
 *
 * Usage: node --experimental-strip-types scripts/ci/check-error-bodies.ts [--write]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOTS = ['apps/api-videos/src', 'apps/admin-api/src'];
export const BASELINE = 'scripts/ci/error-bodies-baseline.txt';

const PATTERN = /\bsuccess\s*:\s*false\b/g;
const SKIP_DIR = new Set(['node_modules', 'dist', '.wrangler', '__tests__', 'test', 'tests', '__mocks__']);
const SOURCE = /\.(ts|tsx|js|mjs)$/;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;
const NOT_HTTP = /error-body:\s*not-http/;

export interface Finding {
  file: string;
  line: number;
  text: string;
}

/** Hand-written error bodies in one file's text (path relative to the repo root). */
export function scanText(file: string, text: string): Finding[] {
  const lines = text.split('\n');
  const findings: Finding[] = [];
  lines.forEach((line, i) => {
    if (NOT_HTTP.test(line) || (i > 0 && NOT_HTTP.test(lines[i - 1]))) return;
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    PATTERN.lastIndex = 0;
    const matches = line.match(PATTERN);
    if (matches) for (let k = 0; k < matches.length; k++) findings.push({ file, line: i + 1, text: trimmed.slice(0, 160) });
  });
  return findings;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE.test(name) && !TEST_FILE.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
}

export function scanRepo(root: string): Finding[] {
  const files: string[] = [];
  for (const r of ROOTS) walk(join(root, r), files);
  return files.sort().flatMap((path) => scanText(relative(root, path), readFileSync(path, 'utf8')));
}

export function countByFile(findings: Finding[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.file, (counts.get(f.file) ?? 0) + 1);
  return counts;
}

export function parseBaseline(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.lastIndexOf(' ');
    map.set(line.slice(0, at), Number(line.slice(at + 1)));
  }
  return map;
}

export function formatBaseline(counts: Map<string, number>): string {
  const header =
    '# Files not yet moved to apiError(), with their count of hand-written `success: false` bodies.\n# Counts may only shrink. Regenerate: node --experimental-strip-types scripts/ci/check-error-bodies.ts --write\n';
  return header + [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, n]) => `${file} ${n}`).join('\n') + (counts.size ? '\n' : '');
}

/** Problems comparing the scan with the baseline: grown or new files, and stale entries. */
export function compare(counts: Map<string, number>, baseline: Map<string, number>, findings: Finding[]): string[] {
  const problems: string[] = [];
  for (const [file, n] of counts) {
    const allowed = baseline.get(file) ?? 0;
    if (n > allowed) {
      problems.push(`${file}: ${n} hand-written error bod${n === 1 ? 'y' : 'ies'}, baseline allows ${allowed}. Answer with apiError(c, status, code, extra) from lib/api-error.ts:`);
      for (const f of findings.filter((x) => x.file === file)) problems.push(`  ${f.file}:${f.line} ${f.text}`);
    }
  }
  for (const [file, allowed] of baseline) {
    const n = counts.get(file) ?? 0;
    if (n < allowed) problems.push(`${file}: baseline says ${allowed} but there are ${n} now; update the baseline (--write).`);
  }
  return problems;
}

function main(): void {
  const root = process.cwd();
  const baselinePath = join(root, BASELINE);
  const findings = scanRepo(root);
  const counts = countByFile(findings);
  if (process.argv.includes('--write')) {
    writeFileSync(baselinePath, formatBaseline(counts));
    console.log(`Wrote ${counts.size} file(s) to the baseline.`);
    return;
  }
  let baseline = new Map<string, number>();
  try {
    baseline = parseBaseline(readFileSync(baselinePath, 'utf8'));
  } catch {
    // no baseline: every finding fails
  }
  const problems = compare(counts, baseline, findings);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`error-bodies: ok (${findings.length} hand-written bod${findings.length === 1 ? 'y' : 'ies'} left in ${counts.size} baseline file(s)).`);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
