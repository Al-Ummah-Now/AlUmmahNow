import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compilePackage, resolvedColors } from '../src/compile.ts';
import { duplicatePackage, nextVersion } from '../src/edit.ts';
import { checkSchema } from '../src/json-schema.ts';
import { parseRefs, toCss } from '../src/refs.ts';
import { SCHEMA } from '../src/schema.generated.ts';
import type { ThemePackage } from '../src/types.ts';
import { svgProblem, validatePackage } from '../src/validate.ts';
import { createZip, packageToZip, readZip, zipToPackage } from '../src/zip.ts';
import { BUILT_IN, THEMES_DIR, loadPackageDir } from '../scripts/load.ts';

const fawanees = () => loadPackageDir(`${THEMES_DIR}/fawanees`);
const clone = <T>(v: T): T => structuredClone(v);
const messages = (r: { errors: { path: string; message: string }[] }) => r.errors.map((e) => `${e.path}: ${e.message}`);

test('the generated schema module is the published schema', () => {
  const published = JSON.parse(readFileSync(new URL('../../../docs/themes/theme-package.v1.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(SCHEMA, published);
});

test('every built-in package is valid, with its assets', () => {
  for (const id of BUILT_IN.ids) {
    const { theme, assets } = loadPackageDir(`${THEMES_DIR}/${id}`);
    const result = validatePackage(theme, { assets, builtIn: true });
    assert.deepEqual(messages(result), [], id);
    assert.equal(theme.id, id);
  }
});

test('schema: names the missing field, the unknown field and the bad value', () => {
  const { theme } = fawanees();
  const t = clone(theme) as any;
  delete t.components.header.style.edge;
  t.components.header.colors.light.bg = 'gold';
  t.tokens.color.dark.oops = '#000000';
  t.surprise = true;
  const errs = messages(validatePackage(t));
  assert.ok(errs.includes('components.header.style.edge: is missing'), errs.join('\n'));
  assert.ok(errs.some((e) => e.startsWith('components.header.colors.light.bg: must be hexColor or colorRef')), errs.join('\n'));
  assert.ok(errs.includes('tokens.color.dark.oops: is not a known field'));
  assert.ok(errs.includes('surprise: is not a known field'));
  t['x-notes'] = 'kept';
  assert.ok(!messages(validatePackage(t)).some((e) => e.startsWith('x-notes')));
});

test('layered backgrounds: a colour layer is refused, a gradient is accepted (#937)', () => {
  const { theme } = fawanees();
  const t = clone(theme) as any;
  t.components.card.style.background = 'linear-gradient(135deg,color-mix(in srgb,white 16%,transparent),transparent 46%),color-mix(in srgb,{color.surface} 84%,transparent)';
  t.components.menu.style.background = '{color.surface}';
  const errs = messages(validatePackage(t));
  assert.ok(errs.some((e) => e.startsWith('components.card.style.background: has a colour layer (color-mix(')), errs.join('\n'));
  assert.ok(errs.some((e) => e.startsWith('components.menu.style.background: has a colour layer')), errs.join('\n'));
  t.components.card.style.background = 'linear-gradient(135deg,white,transparent 46%),linear-gradient(color-mix(in srgb,{color.surface} 84%,transparent),color-mix(in srgb,{color.surface} 84%,transparent))';
  t.components.menu.style.background = 'linear-gradient({color.surface},{color.surface})';
  assert.ok(!messages(validatePackage(t)).some((e) => e.includes('colour layer')));
});

test('schema: CSS values cannot break out of their declaration or load remote content', () => {
  const bad = ['red;}body{display:none', 'url(https://evil.example/x.png)', '</style><script>', 'var(--fanous-color-primary)', '@import x', 'expression(alert(1))', '{nope.thing}', 'a\\62 c'];
  for (const value of bad) assert.ok(checkSchema(value, SCHEMA.$defs.cssValue, SCHEMA).length > 0, value);
  for (const value of ['none', 'linear-gradient(180deg,{color.primary},transparent)', 'path("M0 0L1 1Z")', 'radial-gradient(at var(--from) 50%,{material.glow},transparent)', '{asset:assets/bg.svg} center/cover no-repeat'])
    assert.deepEqual(checkSchema(value, SCHEMA.$defs.cssValue, SCHEMA), [], value);
});

test('schema: asset paths stay inside assets/', () => {
  for (const p of ['assets/../theme.json', '/etc/passwd', 'https://x/y.png', 'assets/x.exe', 'logo.png']) assert.ok(checkSchema(p, SCHEMA.$defs.asset, SCHEMA).length > 0, p);
  assert.deepEqual(checkSchema('assets/ornaments/star-1.svg', SCHEMA.$defs.asset, SCHEMA), []);
});

test('references: unknown names, missing files and loops are errors', () => {
  const { theme, assets } = fawanees();
  const t = clone(theme);
  t.components.card.style!.edge = '0 0 0 1px {color.nope},0 0 4px {material.nope}';
  t.components.page.style!.background = '{asset:assets/missing.svg}';
  t.tokens.color.light.surface = '{color.surfaceRaised}';
  t.tokens.color.light.surfaceRaised = '{color.surface}';
  const errs = messages(validatePackage(t, { assets }));
  assert.ok(errs.some((e) => e.includes('{color.nope} names an unknown colour role')), errs.join('\n'));
  assert.ok(errs.some((e) => e.includes('{material.nope} names an unknown material')));
  assert.ok(errs.some((e) => e.includes('names assets/missing.svg, which is not in the package')));
  assert.ok(errs.some((e) => e.includes('colour references loop')));
});

test('assets: unsafe SVGs, fake extensions and unused files', () => {
  assert.equal(svgProblem('<svg><script>alert(1)</script></svg>'), 'contains a script or entity');
  assert.equal(svgProblem('<svg><image href="https://x/y.png"/></svg>'), 'contains an external reference');
  assert.equal(svgProblem('<svg onload="x()"></svg>'), 'contains a script or entity');
  assert.equal(svgProblem('<svg><use href="#a"/></svg>'), undefined);
  const { theme, assets } = fawanees();
  const extra = { ...assets, 'assets/fake.png': new TextEncoder().encode('<svg></svg>'), 'assets/spare.svg': new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') };
  const result = validatePackage(theme, { assets: extra });
  assert.ok(messages(result).includes('assets/fake.png: is not a real .png file'));
  assert.ok(result.warnings.some((w) => w.path === 'assets/spare.svg'));
});

test('contrast: a text colour that fails WCAG AA names the pair and the ratio', () => {
  const { theme } = fawanees();
  const t = clone(theme);
  t.tokens.color.light.textPrimary = '#fff1c4';
  const errs = messages(validatePackage(t));
  assert.ok(errs.some((e) => e.startsWith('tokens.color.light.textPrimary: #fff1c4 on background #fff1c4 is 1.00:1, needs 4.5:1')), errs.join('\n'));
  const u = clone(theme);
  u.components.header.colors!.light.text = u.components.header.colors!.light.bg;
  assert.ok(messages(validatePackage(u)).some((e) => e.startsWith('components.header.colors.light.text: nav.text')));
});

test('compile: references become custom properties, assets become URLs, all scoped to the theme', () => {
  assert.deepEqual(parseRefs('a {color.primary} {asset:assets/x.svg}').map((r) => r.kind), ['color', 'asset']);
  assert.equal(toCss('0 0 4px {material.glow},{component.nav.activeBg} {radius.md}', (p) => p), '0 0 4px var(--m-glow),var(--fanous-c-nav-active-bg) var(--r-md)');
  const { theme } = fawanees();
  const t = clone(theme);
  t.id = 'night-market';
  t.components.page.style!.background = '{asset:assets/sky.svg} center/cover,{color.background}';
  const css = compilePackage(t, { assetUrl: (p) => `https://cdn.test/t/1.0.0/${p}` });
  assert.ok(css.materials.startsWith("html[data-theme='night-market']{--r-sm:6px;"));
  assert.ok(css.materials.includes('--m-page:url("https://cdn.test/t/1.0.0/assets/sky.svg") center/cover,var(--fanous-color-background)'));
  assert.ok(css.tokens.includes("html[data-theme='night-market'].dark {"));
  assert.ok(!/^:root/m.test(css.tokens), 'a served package does not touch :root');
  assert.ok(css.player.includes('--fanous-player-played: linear-gradient(90deg,#e0962a,#f4ae3a 50%,#fbc661);'));
  assert.ok(!css.css.includes('{'.repeat(2)));
});

test('compile: a token change reaches every component that references it', () => {
  const { theme } = fawanees();
  const t = clone(theme);
  t.tokens.color.dark.surfaceRaised = '#123456';
  const colors = resolvedColors(t);
  assert.equal(colors.dark.roles.surfaceRaised, '#123456');
  assert.equal(colors.dark.parts['menu.bg'], '#123456');
  assert.ok(compilePackage(t).tokens.includes('--fanous-c-menu-bg: #123456;'));
});

test('compile: bundled fonts become @font-face rules and body stacks', () => {
  const { theme } = fawanees();
  const t = clone(theme);
  t.typography.faces = [{ family: 'Reem Kufi', weight: 700, src: 'assets/fonts/reem-700.woff2' }];
  t.typography.body = { latin: ['Inter', 'system-ui'], arabic: ['Reem Kufi', 'sans-serif'] };
  const { fonts } = compilePackage(t, { assetUrl: (p) => `/x/${p}` });
  assert.ok(fonts.includes(`@font-face{font-family:'Reem Kufi';font-weight:700;font-style:normal;font-display:swap;src:url("/x/assets/fonts/reem-700.woff2") format('woff2')}`));
  assert.ok(fonts.includes(`html[data-theme='fawanees'][lang=ar] body .font-inter{font-family:'Reem Kufi',sans-serif}`));
});

test('zip: a package survives export and import, folder or root layout', async () => {
  const files = fawanees();
  const back = await zipToPackage(packageToZip(files));
  assert.deepEqual(back.theme, files.theme);
  assert.deepEqual(Object.keys(back.assets).sort(), Object.keys(files.assets).sort());
  for (const [k, v] of Object.entries(files.assets)) assert.deepEqual(back.assets[k], v);
  const root = createZip({ 'theme.json': new TextEncoder().encode(JSON.stringify(files.theme)), 'assets/a.svg': new TextEncoder().encode('<svg/>'), 'notes.txt': new Uint8Array([1]) });
  const fromRoot = await zipToPackage(root);
  assert.deepEqual(Object.keys(fromRoot.assets), ['assets/a.svg']);
});

test('zip: reads deflated entries and rejects bad archives', async () => {
  const data = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.repeat(20));
  const deflated = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const zip = createZip({ 'assets/a.svg': deflated });
  // Mark the entry as deflated with the real size, in both headers
  const view = new DataView(zip.buffer);
  view.setUint16(8, 8, true); view.setUint32(22, data.length, true);
  const central = zip.length - 22 - (46 + 'assets/a.svg'.length);
  view.setUint16(central + 10, 8, true); view.setUint32(central + 24, data.length, true);
  assert.deepEqual((await readZip(zip))['assets/a.svg'], data);
  await assert.rejects(readZip(new Uint8Array(10)), /not a zip/);
  // A deflated entry that inflates past its declared size is stopped, not inflated in full
  const bomb = createZip({ 'assets/a.svg': deflated });
  const bv = new DataView(bomb.buffer);
  bv.setUint16(8, 8, true); bv.setUint32(22, 10, true);
  bv.setUint16(central + 10, 8, true); bv.setUint32(central + 24, 10, true);
  await assert.rejects(readZip(bomb), /larger than it says/);
  await assert.rejects(zipToPackage(createZip({ 'a.txt': new Uint8Array([1]) })), /no theme.json/);
});

test('duplicate and versions', () => {
  const { theme } = fawanees();
  const copy: ThemePackage = duplicatePackage(theme, 'fawanees-eid', { en: 'Eid', ar: 'عيد' }, 'admin@test');
  assert.equal(copy.kind, 'custom');
  assert.equal(copy.basedOn, 'fawanees@1.1.0');
  assert.equal(copy.version, '1.0.0');
  assert.deepEqual(copy.components, theme.components);
  assert.throws(() => duplicatePackage(theme, 'Bad Id', copy.name, 'x'));
  assert.equal(nextVersion([]), '1.0.0');
  assert.equal(nextVersion(['1.0.0', '1.2.0', '1.10.0']), '1.11.0');
});

test('player chrome: bar-pad-compact is optional, so packages made before it still load and compile', () => {
  const { theme, assets } = fawanees();
  const t = clone(theme) as ThemePackage;
  assert.equal((t.components.player.chrome as Record<string, string>)['bar-pad-compact'], '14px 8px 2px');
  delete (t.components.player.chrome as Record<string, string>)['bar-pad-compact'];
  assert.deepEqual(messages(validatePackage(t, { assets, builtIn: true })), []);
  const css = compilePackage(t).player;
  // Left out rather than written as "undefined": the skin falls back to bar-pad
  assert.ok(!css.includes('bar-pad-compact'), css);
  assert.ok(!css.includes('undefined'), css);
  assert.ok(css.includes('--fanous-player-bar-pad: 44px 12px 6px;'), css);
});
