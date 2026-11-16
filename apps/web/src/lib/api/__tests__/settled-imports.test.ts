/**
 * Components and hooks call the caption and translate Server Actions through their settled
 * wrappers (caption-drafts-client.ts, translate-client.ts), so a call that cannot complete never
 * leaves a spinner on (owner review 2026-11-16). A direct import of the raw 'use server' module
 * from browser code would bring the endless spinner back.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..', '..');
const RAW = /from ['"]@\/lib\/api\/(caption-drafts|translate)['"]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(path);
  }
  return out;
}

describe('settled Server Action imports', () => {
  it('no component or hook imports the raw caption-drafts or translate actions', () => {
    const offenders = ['components', 'hooks', 'app']
      .flatMap((d) => walk(join(SRC, d)))
      .filter((file) => RAW.test(readFileSync(file, 'utf8')))
      .filter((file) => readFileSync(file, 'utf8').trimStart().startsWith("'use client'") || file.includes('/components/') || file.includes('/hooks/'))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('every raw action has a settled wrapper', () => {
    for (const mod of ['caption-drafts', 'translate']) {
      const raw = readFileSync(join(SRC, 'lib', 'api', `${mod}.ts`), 'utf8');
      const client = readFileSync(join(SRC, 'lib', 'api', `${mod}-client.ts`), 'utf8');
      const actions = [...raw.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
      expect(actions.length).toBeGreaterThan(0);
      for (const name of actions) expect(client).toContain(`export const ${name} = settleAction('${name}', `);
    }
  });
});
