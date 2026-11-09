// CI gate. Scans tracked UI source for colours outside the tokens, against a shrinking per-file allowlist.
// `--update` only lowers existing counts and removes clean files. It never allows a new colour.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareToAllowlist, countViolations, type Allowlist } from './color-lint.ts';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const ALLOWLIST = join(ROOT, 'theme-colors.allowlist.json');
const SKIP = /(^|\/)(__tests__|__mocks__|e2e|test)\/|\.(test|spec)\.|\.d\.ts$|(^|\/)theme\/site-themes\.css$/;

const tracked = execFileSync('git', ['ls-files', '--', 'apps/web/src', 'apps/admin-web/src'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
const found: Allowlist = {};
for (const file of tracked) {
  if (!/\.(tsx?|jsx?|css)$/.test(file) || SKIP.test(file)) continue;
  const count = countViolations(readFileSync(join(ROOT, file), 'utf8'));
  if (count) found[file] = count;
}
const allowed: Allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));

if (process.argv.includes('--update')) {
  const next = Object.fromEntries(Object.entries(allowed).filter(([f]) => found[f]).map(([f, n]) => [f, Math.min(n, found[f])]));
  writeFileSync(ALLOWLIST, `${JSON.stringify(next, null, 2)}\n`);
}
const current: Allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
const problems = compareToAllowlist(found, current);
problems.forEach((p) => console.error(p));
if (problems.length) process.exit(1);
const total = Object.values(current).reduce((a, b) => a + b, 0);
console.log(`Theme colours: no new hard-coded colours. ${total} remain allowlisted in ${Object.keys(current).length} files.`);
