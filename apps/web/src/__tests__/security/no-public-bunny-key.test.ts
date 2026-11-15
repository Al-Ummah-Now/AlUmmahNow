/**
 * Guard: Next inlines every NEXT_PUBLIC_* variable into the browser bundle,
 * so a Bunny API key under that prefix would be readable by any visitor.
 * No web source file may name one. Server code uses server-only secrets.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..');
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// Names in this file are built from parts so it does not match itself.
const FORBIDDEN = /NEXT_PUBLIC_BUNNY_[A-Z0-9_]*(API_KEY|ACCESS_KEY|SECRET)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

describe('no public Bunny API key', () => {
  it('matches the names it must catch and not the public CDN settings', () => {
    expect(FORBIDDEN.test(['NEXT', 'PUBLIC', 'BUNNY', 'API', 'KEY'].join('_'))).toBe(true);
    expect(FORBIDDEN.test(['NEXT', 'PUBLIC', 'BUNNY', 'STREAM', 'API', 'KEY'].join('_'))).toBe(true);
    expect(FORBIDDEN.test('NEXT_PUBLIC_BUNNY_LIBRARY_ID')).toBe(false);
    expect(FORBIDDEN.test('NEXT_PUBLIC_BUNNY_TOKEN_AUTH')).toBe(false);
  });

  it('no file under apps/web/src names a NEXT_PUBLIC_* Bunny key or secret', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => FORBIDDEN.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
