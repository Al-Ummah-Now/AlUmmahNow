import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { primaryTextFailures } from '../src/contrast.ts';
import { imageInfo, loadThemes, loadTokens, offLogoColors, resolveChain, resolveTheme, svgProblem, THEMES_DIR, themeModel, validateThemes, type Themes } from '../src/themes.ts';

const tokens = loadTokens();
const fresh = (): Themes => structuredClone(loadThemes());
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('every registered theme passes validation', () => {
  assert.deepEqual(validateThemes(fresh(), tokens), []);
});

test('the four themes are registered and fawanees is the default', () => {
  const t = fresh();
  assert.deepEqual(t.ids, ['lantern', 'zujaj', 'nahas', 'fawanees']);
  assert.equal(t.defaultTheme, 'fawanees');
});

test('lantern keeps the approved gold, and fawanees overrides only its own', () => {
  const t = fresh();
  assert.equal(resolveTheme('lantern', t).color.dark.primary, '{color.derived.gold}');
  const f = themeModel('fawanees', t, tokens);
  for (const m of [f.themes.dark, f.themes.light]) assert.equal(m.find((c) => c.name === 'primary')!.hex, '#f4ae3a');
  assert.equal(themeModel('lantern', t, tokens).themes.dark.find((c) => c.name === 'primary')!.hex, '#e8b477');
});

test('a theme with a parent inherits what it leaves out, and owns what it sets', () => {
  const r = resolveTheme('fawanees', fresh());
  assert.equal(r.brand.logo.dark, 'lantern/assets/logo.png');
  assert.equal(r.auth.headerGraphic.dark, 'fawanees/assets/auth-header.dark.svg');
  assert.equal(r.font, 'system');
});

test('a parent can be any theme, and the chain resolves through grandparents', () => {
  const t = fresh();
  t.ids.push('child');
  t.byId.child = { id: 'child', kind: 'event', extends: 'fawanees', name: { en: 'C', ar: 'س' }, color: { dark: { motif: '#123456' } } };
  assert.deepEqual(resolveChain('child', t), ['child', 'fawanees', 'lantern']);
  const r = resolveTheme('child', t);
  assert.equal(r.color.dark.motif, '#123456');
  assert.equal(r.color.light.primary, '#f4ae3a');
  assert.equal(r.brand.favicon, 'lantern/assets/favicon.ico');
});

test('cycles and unknown parents fail, naming the chain', () => {
  const cycle = fresh();
  cycle.byId.lantern.extends = 'fawanees';
  assert.ok(validateThemes(cycle, tokens).some((e) => /cycle in extends: .*lantern/.test(e)));
  const unknown = fresh();
  unknown.byId.fawanees.extends = 'nope';
  assert.ok(validateThemes(unknown, tokens).some((e) => /fawanees: unknown parent theme "nope"/.test(e)));
});

test('a standalone theme missing a slot fails with its theme, slot and mode', () => {
  const t = fresh();
  delete t.byId.zujaj.color.dark.surface;
  delete t.byId.nahas.auth.headerGraphic.light;
  const errors = validateThemes(t, tokens);
  assert.ok(errors.includes('zujaj: slot color.dark.surface is missing (standalone theme)'));
  assert.ok(errors.includes('nahas: slot auth.headerGraphic.light is missing (standalone theme)'));
});

test('a required slot unresolved through the chain fails', () => {
  const t = fresh();
  delete t.byId.lantern.brand.favicon;
  assert.ok(validateThemes(t, tokens).includes('fawanees: slot brand.favicon is unresolved after walking fawanees -> lantern'));
});

test('optional slots may be absent, and the pattern may be none', () => {
  const t = fresh();
  assert.equal(resolveTheme('nahas', t).motif.pattern, 'none');
  assert.equal(resolveTheme('zujaj', t).banner, undefined);
  delete t.byId.fawanees.banner;
  assert.deepEqual(validateThemes(t, tokens), []);
});

test('an enabled banner needs both languages', () => {
  const t = fresh();
  delete t.byId.fawanees.banner.text.ar;
  assert.ok(validateThemes(t, tokens).includes('fawanees: slot banner.text.ar is missing (a banner needs both languages)'));
});

test('wrong icon dimensions and missing files fail', () => {
  const t = fresh();
  t.byId.zujaj.brand.icon192 = 'zujaj/assets/icon-512.png';
  t.byId.nahas.brand.ogImage = 'nahas/assets/gone.jpg';
  const errors = validateThemes(t, tokens);
  assert.ok(errors.some((e) => e.startsWith('zujaj: slot brand.icon192') && e.includes('must be 192x192, found 512x512')));
  assert.ok(errors.includes('nahas: slot brand.ogImage points to a missing file: nahas/assets/gone.jpg'));
});

test('an Open Graph image and favicon are read from their headers', () => {
  assert.deepEqual(imageInfo(readFileSync(join(THEMES_DIR, 'zujaj/assets/og.jpg'))), { format: 'jpeg', width: 1200, height: 630 });
  assert.deepEqual(imageInfo(readFileSync(join(THEMES_DIR, 'zujaj/assets/favicon.ico'))).sizes?.sort((a, b) => a - b), [16, 32, 48]);
});

test('unsafe SVGs are rejected', () => {
  assert.match(svgProblem('<svg><script>x</script></svg>')!, /script/);
  assert.match(svgProblem('<svg onload="x"></svg>')!, /script/);
  assert.match(svgProblem('<svg><image href="https://x/y.png"/></svg>')!, /external/);
  assert.equal(svgProblem('<svg><rect fill="url(#a)" stroke="var(--fanous-color-primary)"/></svg>'), undefined);
});

test('every theme has its own sign-in graphic in both modes', () => {
  const t = fresh();
  const seen = new Set<string>();
  for (const id of t.ids) {
    const g = resolveTheme(id, t).auth.headerGraphic;
    assert.ok(g.light.startsWith(`${id}/`) && g.dark.startsWith(`${id}/`), id);
    seen.add(readFileSync(join(THEMES_DIR, g.dark), 'utf8'));
  }
  assert.equal(seen.size, t.ids.length);
});

test('a colour outside the logo hues fails, and status colours are exempt', () => {
  const t = fresh();
  t.byId.zujaj.color.dark.primary = '#7a3ff2';
  assert.ok(validateThemes(t, tokens).some((e) => e.startsWith('zujaj: dark.primary #7a3ff2 is outside')));
  assert.deepEqual(offLogoColors(themeModel('lantern', fresh(), tokens)), []);
});

test('text on primary is at least 7:1 in every theme', () => {
  const t = fresh();
  for (const id of t.ids) assert.deepEqual(primaryTextFailures(themeModel(id, t, tokens)), [], id);
  t.byId.nahas.color.dark.onPrimary = '#7a4a10';
  assert.ok(validateThemes(t, tokens).some((e) => e.startsWith('nahas: ')));
});

test('build emits only the active theme, with paths inside the output', () => {
  const out = mkdtempSync(join(tmpdir(), 'fanous-'));
  try {
    const run = (env: Record<string, string>, ...args: string[]) => execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', CLI, 'build', '--out', out, ...args], { env: { ...process.env, ...env } });
    run({ ACTIVE_THEME: 'nahas' });
    assert.match(readFileSync(join(out, 'web/tokens.css'), 'utf8'), /--fanous-color-primary: #ffa037;/);
    const manifest = readFileSync(join(out, 'theme.json'), 'utf8');
    assert.ok(!/(lantern|zujaj|fawanees)\/assets/.test(manifest));
    assert.ok(existsSync(join(out, 'assets/og.jpg')));
    assert.ok(!existsSync(join(out, 'lantern')));
    run({}, '--theme', 'fawanees');
    assert.match(readFileSync(join(out, 'web/tokens.css'), 'utf8'), /--fanous-color-primary: #f4ae3a;/);
    assert.throws(() => run({ ACTIVE_THEME: 'nope' }));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('every interface part has a colour in both modes, and reaches the web output', () => {
  const t = fresh();
  for (const id of t.ids) {
    const m = themeModel(id, t, tokens);
    const names = Object.keys(tokens.components.parts);
    assert.deepEqual(Object.keys(m.components.dark), names, id);
    for (const hex of [...Object.values(m.components.dark), ...Object.values(m.components.light)]) assert.match(hex, /^#[0-9a-f]{6}$/, id);
  }
});

test('a part below its contrast minimum fails, naming the theme, mode and part', () => {
  const t = fresh();
  t.byId.zujaj.component.light['nav.text'] = '#0f5a6b';
  assert.ok(validateThemes(t, tokens).some((e) => e.startsWith('zujaj: component light: nav.text #0f5a6b on nav.bg')));
});

test('a part colour outside the logo hues fails', () => {
  const t = fresh();
  t.byId.nahas.component.dark['nav.bg'] = '#7a3ff2';
  assert.ok(validateThemes(t, tokens).some((e) => e.startsWith('nahas: dark.nav.bg #7a3ff2 is outside')));
});

test('text on the primary and upload buttons is held to 7:1 per part', () => {
  const t = fresh();
  t.byId.lantern.component.dark['upload.text'] = '#7a4a10';
  assert.ok(validateThemes(t, tokens).some((e) => /lantern: component dark: upload\.text .* \(needs 7\)/.test(e)));
});

test('a child inherits part overrides and can replace one', () => {
  const t = fresh();
  t.ids.push('kid');
  t.byId.kid = { id: 'kid', kind: 'event', extends: 'zujaj', name: { en: 'K', ar: 'ك' }, component: { light: { 'nav.bg': '#0c4c5b' } } };
  const m = themeModel('kid', t, tokens);
  assert.equal(m.components.light['nav.bg'], '#0c4c5b');
  assert.equal(m.components.light['upload.border'], '#f5cf92');
});
