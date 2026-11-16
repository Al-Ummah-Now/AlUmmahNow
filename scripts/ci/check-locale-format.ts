/**
 * Every number, date and time people read is formatted by packages/shared-types/src/locale-format.ts
 * (owner decision 2026-11-15, #1488/#1496: Arabic uses Eastern Arabic (Hindi) numerals ٠–٩, with
 * the numbering system pinned so the server and every browser agree).
 *
 * Fails on, outside that module:
 *   - `new Intl.NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules|ListFormat(`
 *   - `.toLocaleString(`, `.toLocaleDateString(`, `.toLocaleTimeString(`
 *   - the literals `ar-SA`, `ar-EG`, `nu-latn`, `chartLocale(`, and `style: 'currency'` (money goes
 *     through moneyFormat/formatMoney, which writes the currency's Arabic name)
 *   - a clock built by hand in a template (`${m}:${String(s).padStart(2, '0')}`): times people read
 *     go through formatClock (the video player's through apps/web/src/lib/video/player-time.ts)
 *
 * A line that formats for a machine (time-zone maths, sorting) and not for a reader can say so
 * with a `locale-format: machine` comment on it or the line before.
 *
 * Files not moved yet are listed in locale-format-baseline.txt with their count. A count can't
 * grow; when it shrinks, the baseline has to be updated in the same change (run with --write).
 *
 * Usage: node --experimental-strip-types scripts/ci/check-locale-format.ts [--write]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOTS = [
  'apps/web/src',
  'apps/admin-web/src',
  'apps/api-videos/src',
  'apps/admin-api/src',
  'apps/status/src',
  'apps/websocket-server/src',
  'apps/cost-monitor/src',
  'apps/media/src',
  'apps/processor/src',
  'apps/scheduler/src',
  'apps/short-links/src',
  'packages/shared-types/src',
];

export const FORMATTER = 'packages/shared-types/src/locale-format.ts';

const RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Intl constructor', pattern: /\bnew\s+Intl\.(NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules|ListFormat)\s*\(/g },
  { name: 'toLocale*String', pattern: /\.toLocale(Date|Time)?String\s*\(/g },
  { name: 'locale literal', pattern: /['"`]ar-(SA|EG)\b|nu-latn/g },
  { name: 'chartLocale', pattern: /\bchartLocale\s*\(/g },
  { name: 'currency style (use moneyFormat/formatMoney)', pattern: /style:\s*['"]currency['"]/g },
  // A clock built by hand ("1:05" from padStart) shows 0–9 on Arabic pages: use formatClock (#1541)
  { name: 'hand-built clock (use formatClock)', pattern: /:\$\{[^`]*?\.padStart\(\s*2\s*,\s*['"]0['"]\s*\)/g },
];

const SKIP_DIR = new Set(['node_modules', '.next', 'dist', '.open-next', '.wrangler', '__tests__', 'test', 'tests', 'e2e', '__mocks__']);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|astro)$/;
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;
const MACHINE = /locale-format:\s*machine/;

export interface Finding {
  file: string;
  line: number;
  rule: string;
  text: string;
}

/** Findings in one file's text (path relative to the repo root). */
export function scanText(file: string, text: string): Finding[] {
  if (file === FORMATTER) return [];
  const lines = text.split('\n');
  const findings: Finding[] = [];
  lines.forEach((line, i) => {
    if (MACHINE.test(line) || (i > 0 && MACHINE.test(lines[i - 1]))) return;
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      if (rule.name === 'chartLocale' && /export function chartLocale/.test(line)) continue;
      const matches = line.match(rule.pattern);
      if (matches) for (let k = 0; k < matches.length; k++) findings.push({ file, line: i + 1, rule: rule.name, text: trimmed.slice(0, 160) });
    }
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
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
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
  const header = '# Files not yet moved to locale-format, with their count of direct Intl/toLocale calls.\n# Counts may only shrink. Regenerate: node --experimental-strip-types scripts/ci/check-locale-format.ts --write\n';
  return header + [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, n]) => `${file} ${n}`).join('\n') + (counts.size ? '\n' : '');
}

/** Problems comparing the scan with the baseline: grown or new files, and stale entries. */
export function compare(counts: Map<string, number>, baseline: Map<string, number>, findings: Finding[]): string[] {
  const problems: string[] = [];
  for (const [file, n] of counts) {
    const allowed = baseline.get(file) ?? 0;
    if (n > allowed) {
      problems.push(`${file}: ${n} direct Intl/toLocale call(s), baseline allows ${allowed}. Use the formatters in @al-ummah/shared-types (locale-format):`);
      for (const f of findings.filter((x) => x.file === file)) problems.push(`  ${f.file}:${f.line} [${f.rule}] ${f.text}`);
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
  const baselinePath = join(root, 'scripts/ci/locale-format-baseline.txt');
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
  console.log(`locale-format: ok (${findings.length} call(s) left in ${counts.size} baseline file(s)).`);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
