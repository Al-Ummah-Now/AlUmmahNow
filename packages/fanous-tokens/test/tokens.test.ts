import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contrastFailures, contrastPairs, contrastRatio } from '../src/contrast.ts';
import { generateAll } from '../src/generate.ts';
import { buildModel, kebab, loadModel, TOKENS_URL, type Model } from '../src/model.ts';

const GENERATED = fileURLToPath(new URL('../generated', import.meta.url));
const raw = () => JSON.parse(readFileSync(TOKENS_URL, 'utf8'));
const model = loadModel();
const files = generateAll(model);

test('contrast formula matches known WCAG values', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.equal(contrastRatio('#777777', '#ffffff').toFixed(2), '4.48');
});

test('every text and non-text pair meets WCAG 2.1 AA in both themes', () => {
  assert.deepEqual(contrastFailures(model), []);
});

test('the checker covers every text, on and non-text colour in both themes', () => {
  const pairs = contrastPairs(model);
  for (const [theme, colors] of Object.entries(model.themes)) {
    for (const c of colors.filter((x) => ['text', 'on', 'nontext'].includes(x.role))) {
      assert.ok(pairs.some((p) => p.theme === theme && p.fg === c.name), `${theme}.${c.name} is unchecked`);
    }
  }
});

test('the checker fails a pair below AA', () => {
  const tokens = raw();
  tokens.color.theme.light.textMuted.$value = '#d8d0c4';
  assert.ok(contrastFailures(buildModel(tokens)).some((p) => p.theme === 'light' && p.fg === 'textMuted'));
});

test('a themed colour with no contrast role is rejected', () => {
  const tokens = raw();
  delete tokens.color.theme.dark.link.$extensions;
  assert.throws(() => buildModel(tokens), /no valid contrast role/);
});

test('a fill with no on-colour is rejected', () => {
  const tokens = raw();
  delete tokens.color.theme.dark.onLive;
  assert.throws(() => contrastPairs(buildModel(tokens)), /live has no on-colour/);
});

test('unresolved and circular aliases are rejected', () => {
  const missing = raw();
  missing.color.theme.dark.link.$value = '{color.brand.nope}';
  assert.throws(() => buildModel(missing), /Unresolved token alias/);
  const circular = raw();
  circular.color.brand.night.$value = '{color.brand.glow}';
  circular.color.brand.glow.$value = '{color.brand.night}';
  assert.throws(() => buildModel(circular), /Circular token alias/);
});

test('brand primitives match the spec', () => {
  assert.deepEqual(Object.fromEntries(model.brand.map((b) => [b.name, b.value])), {
    night: '#093041', nightDeep: '#07425a', nightShallow: '#083f58', lantern: '#ffa037', glow: '#ffc46b',
    earth: '#8e6c53', parchment: '#f7f1e8', verified: '#16a34a', error: '#b00020',
  });
});

test('both themes define the same colour names', () => {
  assert.deepEqual(model.themes.light.map((c) => c.name), model.themes.dark.map((c) => c.name));
});

test('D6 is open: the system pair is active and both candidate pairs are offered', () => {
  assert.equal(model.activePair, 'system');
  assert.deepEqual(model.fontPairs.map((p) => p.name), ['system', 'plexSans', 'notoKufiInter']);
  assert.ok(!readFileSync(TOKENS_URL, 'utf8').includes('Farsi'));
});

test('Arabic styles never set letter-spacing and are taller than Latin', () => {
  model.typography.arabic.forEach((s, i) => {
    assert.equal(s.letterSpacing, 0, s.name);
    assert.ok(s.lineHeight > model.typography.latin[i].lineHeight, s.name);
  });
});

test('generated files match the committed snapshots', () => {
  for (const [path, content] of Object.entries(files)) {
    assert.equal(readFileSync(join(GENERATED, path), 'utf8'), content, `${path} is stale, run pnpm tokens:generate`);
  }
});

test('every theme colour reaches every platform in both themes', () => {
  const channel = (hex: string, i: number) => String(Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 10000) / 10000);
  const check = (theme: Model['themes']['dark'], part: (c: Model['themes']['dark'][number]) => [string, string][]) =>
    theme.forEach((c) => part(c).forEach(([file, needle]) => assert.ok(files[file].includes(needle), `${file} missing ${needle}`)));
  for (const theme of [model.themes.dark, model.themes.light]) {
    const isDark = theme === model.themes.dark;
    check(theme, (c) => [
      ['swift/Sources/FanousTokens/FanousTokens.swift', `${c.name}: Color(.sRGB, red: ${channel(c.hex, 1)}`],
      ['kotlin/net/alummahnow/fanous/FanousTokens.kt', `${c.name} = Color(0xFF${c.hex.slice(1).toUpperCase()})`],
      ['winui/Fanous.Colors.xaml', c.hex.slice(1).toUpperCase()],
      [isDark ? 'gtk/style-dark.css' : 'gtk/style.css', `${c.hex};`],
      ['tizen/FanousTokens.cs', `new Color(${channel(c.hex, 1)}f`],
      ['web/tokens.css', `--fanous-color-${kebab(c.name)}: ${c.hex};`],
    ]);
  }
});

test('web output is namespaced so it cannot change existing styles', () => {
  const declared = files['web/tokens.css'].match(/^\s*--[a-z0-9-]+/gm)!.map((v) => v.trim());
  assert.ok(declared.length > 0);
  assert.ok(declared.every((v) => v.startsWith('--fanous-')));
  const selectors = files['web/tokens.css'].match(/^[^\s/@}][^{]*(?=\{)/gm)!.flatMap((s) => s.split(',').map((x) => x.trim()));
  assert.deepEqual([...new Set(selectors)], [':root', "[data-fanous-theme='dark']", "[data-fanous-theme='light']"]);
});

test('reduced motion zeroes web durations', () => {
  const block = files['web/tokens.css'].split('prefers-reduced-motion')[1].split('}')[0];
  assert.match(block, /--fanous-duration-glow-pulse: 0ms/);
});

test('generation is deterministic', () => {
  assert.deepEqual(generateAll(loadModel()), files);
});
