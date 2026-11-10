/**
 * Owner rule: no browser prompts. The log viewer pages must not call
 * alert/confirm/prompt or register beforeunload (this package has no ESLint).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SCANNED = ['public', 'src'];
const FORBIDDEN = [/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/, /['"`]beforeunload['"`]/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(html|js|ts)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('no browser prompts', () => {
  it('viewer and server sources use no alert/confirm/prompt or beforeunload', () => {
    const offenders = SCANNED.flatMap((dir) => files(join(ROOT, dir))).flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      return FORBIDDEN.filter((re) => re.test(text)).map((re) => `${path.slice(ROOT.length + 1)}: ${re}`);
    });
    expect(offenders).toEqual([]);
  });
});
