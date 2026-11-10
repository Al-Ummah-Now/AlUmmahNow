/**
 * Server Components may render a 'use client' module's components, but calling
 * any other export of it from the server throws at render time ("Attempted to
 * call X() from the server"), which typecheck and unit tests never see. This
 * happened on /category-suggestions (categoryLabel), so scan every server file
 * under src/app for named imports from client modules that are not components.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..', 'src');
// The directive must be the first statement: skip leading whitespace and comments (linear scan)
function isClient(code: string): boolean {
  let i = 0;
  for (;;) {
    while (i < code.length && /\s/.test(code[i])) i++;
    if (code.startsWith('//', i)) {
      const end = code.indexOf('\n', i);
      if (end < 0) return false;
      i = end + 1;
    } else if (code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2);
      if (end < 0) return false;
      i = end + 2;
    } else {
      return code.startsWith("'use client'", i) || code.startsWith('"use client"', i);
    }
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

describe('server/client boundary', () => {
  it('server files under src/app import only components (PascalCase) from client modules', () => {
    const problems: string[] = [];
    for (const file of walk(path.join(SRC, 'app'))) {
      const code = readFileSync(file, 'utf8');
      if (isClient(code)) continue;
      for (const m of code.matchAll(/import\s+(?!type\b)\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
        const target = resolve(file, m[2]);
        if (!target || !isClient(readFileSync(target, 'utf8'))) continue;
        const names = m[1].split(',').map((n) => n.trim()).filter((n) => n && !n.startsWith('type '));
        for (const name of names) {
          const local = name.split(/\s+as\s+/)[0];
          if (!/^[A-Z]/.test(local)) problems.push(`${path.relative(SRC, file)} imports ${local} from client module ${m[2]}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });
});
