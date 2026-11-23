import fs from 'node:fs';
import path from 'node:path';

/**
 * A server component can't call a function exported from a 'use client'
 * module (it renders as a 500). Studio server pages may import components
 * from client modules, never helpers: those live in plain modules like
 * lib/studio/params.ts.
 */
const SRC = path.join(__dirname, '../../..');
const STUDIO = path.join(SRC, 'app/[locale]/studio');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function resolve(spec: string): string | null {
  if (!spec.startsWith('@/')) return null;
  const base = path.join(SRC, spec.slice(2));
  return ['.tsx', '.ts', '/index.tsx', '/index.ts'].map((ext) => base + ext).find((f) => fs.existsSync(f)) ?? null;
}

const isClient = (file: string) => /^\s*['"]use client['"]/.test(fs.readFileSync(file, 'utf8'));

describe('Studio server pages', () => {
  const files = walk(STUDIO).filter((f) => /(page|layout)\.tsx$/.test(f) && !isClient(f));

  it.each(files.map((f) => [path.relative(STUDIO, f), f]))('%s calls no helper from a client module', (_name, file) => {
    const source = fs.readFileSync(file, 'utf8');
    const offenders: string[] = [];
    for (const match of source.matchAll(/import\s+\{([^}]*)\}\s+from\s+'([^']+)'/g)) {
      const target = resolve(match[2]);
      if (!target || !isClient(target)) continue;
      const names = match[1].split(',').map((n) => n.trim()).filter((n) => n && !n.startsWith('type '));
      offenders.push(...names.filter((n) => !/^[A-Z][a-z]/.test(n)).map((n) => `${n} from ${match[2]}`));
    }
    expect(offenders).toEqual([]);
  });
});
