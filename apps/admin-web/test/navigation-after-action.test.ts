/**
 * After a Server Action, a client navigation must not be followed by
 * router.refresh(): dispatched while the action is still settling in the
 * router, the refresh runs for the current URL and cancels the push (release
 * v2026.11.10.9: "Delete test group" on /errors/<id> left the admin on the
 * deleted group; the moderation report page had the same bug before). The
 * target pages are dynamic, so the push alone loads fresh data.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Code only: comments may mention the pattern. */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('navigation after a Server Action', () => {
  it('no router.push/replace is followed by router.refresh()', () => {
    const offenders = sources(SRC).filter((file) =>
      /router\.(push|replace)\([^)]*\);?\s*router\.refresh\(\)/.test(stripComments(readFileSync(file, 'utf8'))),
    );
    assert.deepEqual(offenders.map((f) => relative(SRC, f)), []);
  });

  it('the error group page goes back to /errors after deleting a test group', () => {
    const code = stripComments(readFileSync(join(SRC, 'app', '(protected)', 'errors', '[id]', 'ErrorGroupActions.tsx'), 'utf8'));
    assert.match(code, /router\.push\('\/errors'\)/);
  });
});
