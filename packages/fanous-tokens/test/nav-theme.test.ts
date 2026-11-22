import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * The shared header's theme (docs/design/NAV.md "Theme"): each built-in theme's band, edge, blur and
 * control font live in aun-nav.css, generated from the theme packages, so the videos app, its admin,
 * Auth, CMS and www draw one header. The fonts are shipped beside the stylesheet.
 */
const at = (p: string) => new URL(p, import.meta.url);
const css = readFileSync(at('../nav/aun-nav.css'), 'utf8');
const fontsCss = readFileSync(at('../nav/aun-nav-fonts.css'), 'utf8');
const THEMES = ['fawanees', 'lantern', 'nahas', 'zujaj'];
const theme = (id: string) => JSON.parse(readFileSync(at(`../../theme-packages/themes/${id}/theme.json`), 'utf8'));
const block = css.slice(css.indexOf('/* BEGIN theme header'), css.indexOf('/* END theme header */'));
const GENERIC = new Set(['serif', 'sans-serif', 'system-ui', 'monospace']);

test('every built-in theme sets its band and edge in the contract, standing alone', () => {
  for (const id of THEMES) {
    const rule = new RegExp(`html\\[data-theme='${id}'\\](?:,html:not\\(\\[data-theme\\]\\))?\\{([^}]*)\\}`).exec(block);
    assert.ok(rule, id);
    for (const prop of ['--aun-header-band:', '--aun-header-edge:']) assert.ok(rule[1].includes(prop), `${id} ${prop}`);
    // Auth, CMS and www have no videos materials: only theme tokens may be referenced
    assert.doesNotMatch(rule[1], /var\(--m-/, id);
    for (const [, name] of rule[1].matchAll(/var\((--[a-z0-9-]+)/g)) assert.match(name, /^--fanous-(color|c)-/, `${id} reads ${name}`);
  }
  // A page that names no theme gets the default's
  assert.match(block, /html\[data-theme='fawanees'\],html:not\(\[data-theme\]\)\{/);
});

test('the bar paints the band on its own layer, the shared blur behind it, an app override first', () => {
  const header = /\n\.aun-header \{([^}]*)\}/.exec(css)![1];
  assert.match(header, /background: none;/);
  assert.match(header, /box-shadow: var\(--aun-header-edge, none\);/);
  const before = /\n\.aun-header::before \{([^}]*)\}/.exec(css)![1];
  assert.match(before, /background: var\(--aun-header-bg, var\(--aun-header-band, var\(--fanous-c-nav-bg\)\)\);/);
  // The shared chrome blur, the same value where an app does not load aun-surfaces.css
  const glass = /--aun-glass-blur: ([^;]+);/.exec(readFileSync(at('../surfaces/aun-surfaces.css'), 'utf8'))![1];
  assert.ok(before.includes(`backdrop-filter: var(--aun-glass-blur, ${glass});`), before);
  assert.match(before, /z-index: -1;/);
});

test('a theme with a body font puts it on the header controls, Arabic first on Arabic pages', () => {
  for (const id of THEMES) {
    const body = theme(id).typography.body as { latin: string[]; arabic: string[] } | undefined;
    const sel = (suffix = '') => ['button', 'input', 'select', 'textarea'].map((el) => `html[data-theme='${id}'] .aun-header ${el}${suffix}`).join(',');
    if (!body) {
      assert.ok(!block.includes(`html[data-theme='${id}'] .aun-header`), `${id} has no body font: its controls keep the header's`);
      continue;
    }
    const stack = (f: string[]) => f.map((n) => (GENERIC.has(n) ? n : `'${n}'`)).join(',');
    assert.ok(block.includes(`\n${sel()}{font-family:${stack(body.latin)}}`), id);
    assert.ok(block.includes(`\n${sel(':lang(ar)')}{font-family:${stack(body.arabic)}}`), id);
  }
});

test('every font a theme puts on the controls is shipped, from this package only', () => {
  const faces = [...fontsCss.matchAll(/font-family:'([^']+)';font-weight:(\d+);[^}]*src:url\('\/aun-nav\/fonts\/([^']+)'\)/g)];
  const families = new Set(faces.map((f) => f[1]));
  for (const id of THEMES) {
    const body = theme(id).typography.body;
    for (const f of [...(body?.latin ?? []), ...(body?.arabic ?? [])]) if (!GENERIC.has(f)) assert.ok(families.has(f), `${id}: ${f} has no face`);
  }
  // No other host: every src is a file in nav/fonts
  assert.equal(fontsCss.match(/url\(/g)!.length, faces.length);
  const files = readdirSync(at('../nav/fonts')).sort();
  assert.deepEqual(faces.map((f) => f[3]).sort(), files);
});

test('the fonts are the videos app\'s, byte for byte, and its admin serves the same copy', () => {
  const webFaces = readFileSync(at('../../../apps/web/src/theme/font-faces.css'), 'utf8').split('\n').filter((l) => l.startsWith('@font-face'));
  const navFaces = fontsCss.split('\n').filter((l) => l.startsWith('@font-face'));
  assert.deepEqual(navFaces, webFaces.map((l) => l.replace("url('/fonts/", "url('/aun-nav/fonts/")));
  for (const file of readdirSync(at('../nav/fonts'))) {
    const bytes = readFileSync(at(`../nav/fonts/${file}`));
    assert.ok(bytes.equals(readFileSync(at(`../../../apps/web/public/fonts/${file}`))), `web ${file}`);
    assert.ok(bytes.equals(readFileSync(at(`../../../apps/admin-web/public/aun-nav/fonts/${file}`))), `admin-web ${file}`);
  }
});
