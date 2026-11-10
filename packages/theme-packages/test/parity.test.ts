// The built-in packages must compile to exactly what the hand-written themes produced before they
// became packages (test/parity-baseline/, captured at conversion). Declarations are compared per
// selector, so formatting may change but no value, selector or cascade position can.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compilePackage } from '../src/compile.ts';
import { BUILT_IN, THEMES_DIR, loadPackageDir } from '../scripts/load.ts';

const baseline = (f: string) => readFileSync(new URL(`./parity-baseline/${f}`, import.meta.url), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** selector -> property -> value, in source order. Later declarations of a property win, as in CSS. */
export function declarationMap(css: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  const src = stripComments(css);
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const selector = src.slice(i, open).trim().replace(/\s+/g, ' ');
    let depth = 1, j = open + 1;
    while (depth && j < src.length) { if (src[j] === '{') depth++; if (src[j] === '}') depth--; j++; }
    const body = src.slice(open + 1, j - 1);
    if (body.includes('{')) {
      for (const [sel, decls] of declarationMap(body)) out.set(`${selector} ${sel}`, decls);
    } else {
      const decls = out.get(selector) ?? new Map<string, string>();
      let paren = 0, cur = '';
      const push = () => { const k = cur.indexOf(':'); if (k > 0) decls.set(cur.slice(0, k).trim(), cur.slice(k + 1).trim()); cur = ''; };
      for (const ch of body) { if (ch === '(') paren++; if (ch === ')') paren--; if (ch === ';' && !paren) push(); else cur += ch; }
      push();
      out.set(selector, decls);
    }
    i = j;
  }
  return out;
}

const plain = (m: Map<string, Map<string, string>>) => Object.fromEntries([...m].map(([s, d]) => [s, Object.fromEntries(d)]));
const compiled = BUILT_IN.ids.map((id) => ({ id, out: compilePackage(loadPackageDir(`${THEMES_DIR}/${id}`).theme, { isDefault: id === BUILT_IN.default, rootFallback: true }) }));

test('design tokens are byte-identical to the pre-package stylesheet (comments aside)', () => {
  const now = compiled.map((c) => c.out.tokens).join('\n');
  assert.equal(stripComments(now).trim(), stripComments(baseline('site-themes.css')).trim());
});

test('materials: every theme sets the same --r-* and --m-* values on the same selector', () => {
  assert.deepEqual(plain(declarationMap(compiled.map((c) => c.out.materials).join(''))), plain(declarationMap(baseline('materials.css'))));
});

test('body fonts: the same rules for the same selectors (font faces moved to font-faces.css)', () => {
  const before = stripComments(baseline('fonts.css')).split('\n').filter((l) => l.trim() && !l.startsWith('@font-face'));
  const now = stripComments(compiled.map((c) => c.out.fonts).join('')).split('\n').filter((l) => l.trim());
  assert.deepEqual(plain(declarationMap(now.join('\n'))), plain(declarationMap(before.join('\n'))));
  const faces = readFileSync(new URL('../../../apps/web/src/theme/font-faces.css', import.meta.url), 'utf8');
  for (const face of stripComments(baseline('fonts.css')).split('\n').filter((l) => l.startsWith('@font-face'))) assert.ok(faces.includes(face), face);
});

test('player chrome: each theme has its own player.json values, now scoped to the theme', () => {
  for (const { id, out } of compiled) {
    const before = declarationMap(baseline(`${id}.player.css`)).get(':root')!;
    const now = declarationMap(out.player).get(`html[data-theme='${id}']`)!;
    assert.deepEqual(Object.fromEntries(now), Object.fromEntries(before), id);
  }
});
