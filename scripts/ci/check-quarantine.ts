/**
 * Quarantine rule for the release E2E suite: a test may be switched off only
 * with an issue and an owner. Every `test.fixme(` / `.fixme(` call in the suite
 * must carry "quarantined: #<issue> @<owner>" in its own text (its reason
 * argument or a comment on the same or the line before). Anything else fails the
 * job, so nothing goes quiet without someone on the hook for it.
 *
 * Conditional skips (`test.skip(cond, reason)` for "not deployed yet", missing
 * secrets and the like) are not quarantine and are not checked here.
 *
 * Usage: node --experimental-strip-types scripts/ci/check-quarantine.ts <dir>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const QUARANTINE_TAG = /quarantined:\s*#\d+\s+@[\w-]+/i;

export interface Violation {
  file: string;
  line: number;
  text: string;
}

/** fixme calls in `source` that do not name an issue and an owner. */
export function violations(file: string, source: string): Violation[] {
  const lines = source.split('\n');
  const out: Violation[] = [];
  lines.forEach((text, i) => {
    if (!/\.fixme\s*\(/.test(text)) return;
    // The call may span lines: its first three lines and the line before count
    const context = [lines[i - 1] ?? '', text, lines[i + 1] ?? '', lines[i + 2] ?? ''].join('\n');
    if (!QUARANTINE_TAG.test(context)) out.push({ file, line: i + 1, text: text.trim() });
  });
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.ts$/.test(name) ? [path] : [];
  });
}

function main(dir: string | undefined): number {
  if (!dir) {
    process.stderr.write('usage: check-quarantine.ts <dir>\n');
    return 2;
  }
  const found = walk(dir).flatMap((f) => violations(f, readFileSync(f, 'utf8')));
  for (const v of found) {
    process.stdout.write(`::error file=${v.file},line=${v.line}::Quarantined without an issue and an owner: add "quarantined: #<issue> @<owner>" (${v.text})\n`);
  }
  if (!found.length) process.stdout.write(`No unowned quarantine in ${dir}\n`);
  return found.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exit(main(process.argv[2]));
