import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AA_TEXT, AA_TEXT_ON_PRIMARY, contrastRatio } from '../src/contrast.ts';
import { CssEvaluator, hexOf, over, premultiplied, type Rgba } from '../src/css-value.ts';
import { generateNative } from '../src/generators/native.ts';
import { parseXml, svgToVector } from '../src/generators/vector-drawable.ts';
import { buildNativeRegistry, MATERIAL_FILLS, MATERIAL_SHADOWS, MODES, NATIVE_FALLBACK } from '../src/native.ts';
import { loadThemes, loadTokens, themeModel } from '../src/themes.ts';

const vars: Record<string, string> = {
  'fanous-color-primary': '#f4ae3a',
  'fanous-color-surface': '#0e2b3d',
  'fanous-c-nav-bg': '#09151e',
  'm-glow': 'color-mix(in srgb,var(--fanous-color-primary) 46%,transparent)',
};
const ev = new CssEvaluator((n) => vars[n], 'test');

test('colours: hex, rgb with slash alpha, names', () => {
  assert.deepEqual(ev.color('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(ev.color('#00000033'), [0, 0, 0, 0.2]);
  assert.deepEqual(ev.color('rgb(9 21 30/.95)'), [9, 21, 30, 0.95]);
  assert.deepEqual(ev.color('transparent'), [0, 0, 0, 0]);
});

test('color-mix follows CSS: a mix with transparent keeps the hue and scales alpha', () => {
  assert.deepEqual(ev.color('color-mix(in srgb,var(--fanous-color-primary) 22%,transparent)'), [244, 174, 58, 0.22]);
  assert.deepEqual(ev.color('color-mix(in srgb,white 50%,black)'), [127.5, 127.5, 127.5, 1]);
  assert.deepEqual(ev.color('color-mix(in srgb,var(--fanous-c-nav-bg) 84%,var(--fanous-color-primary))').slice(3), [1]);
  // Percentages below 100% in total scale alpha, as the spec says.
  assert.deepEqual(ev.color('color-mix(in srgb,white 20%,black 30%)')[3], 0.5);
});

test('var() resolves recursively and an unknown var fails with its name', () => {
  assert.deepEqual(ev.color('var(--m-glow)'), [244, 174, 58, 0.46]);
  assert.throws(() => ev.color('var(--nope)'), /unknown var\(--nope\)/);
});

test('linear gradients: angles, keywords and the logical end direction', () => {
  const [l] = ev.fills('linear-gradient(180deg,#000,#fff 46%)');
  assert.equal(l.kind, 'linear');
  assert.deepEqual(l.kind === 'linear' && [l.angle, l.logical, l.stops.map((s) => s.at)], [180, false, [0, 0.46]]);
  const [e] = ev.fills('linear-gradient(var(--to-end),#000,#111 50%,#fff)');
  assert.deepEqual(e.kind === 'linear' && [e.angle, e.logical], [90, true]);
});

test('stops without positions are spread evenly between their neighbours', () => {
  const [l] = ev.fills('linear-gradient(0deg,#000,#111,#222,#fff 90%)');
  assert.deepEqual(l.kind === 'linear' && l.stops.map((s) => s.at), [0, 0.3, 0.6, 0.9]);
});

test('radial gradients: explicit radii, circles, positions and the logical start', () => {
  const [a] = ev.fills('radial-gradient(38% 36% at 16% 8%,#fff,transparent 72%)');
  assert.deepEqual(a.kind === 'radial' && [a.shape, a.size, a.cx, a.cy, a.logicalX], ['ellipse', { rx: 0.38, ry: 0.36 }, 0.16, 0.08, false]);
  const [b] = ev.fills('radial-gradient(circle at 38% 30%,#fff,#000 55%,#111)');
  assert.deepEqual(b.kind === 'radial' && [b.shape, b.size, b.cx, b.cy], ['circle', 'farthest-corner', 0.38, 0.3]);
  const [c] = ev.fills('radial-gradient(120% 200% at var(--from) 50%,#fff,transparent 74%)');
  assert.deepEqual(c.kind === 'radial' && [c.cx, c.logicalX], [0, true]);
  const [d] = ev.fills('radial-gradient(closest-side,#fff,transparent)');
  assert.equal(d.kind === 'radial' && d.size, 'closest-side');
});

test('a fade to transparent keeps the neighbour hue, and splits between two hues', () => {
  const s = premultiplied([{ color: [255, 0, 0, 1], at: 0 }, { color: [0, 0, 0, 0], at: 0.5 }, { color: [0, 0, 255, 1], at: 1 }]);
  assert.deepEqual(s.map((x) => [x.color, x.at]), [[[255, 0, 0, 1], 0], [[255, 0, 0, 0], 0.5], [[0, 0, 255, 0], 0.5], [[0, 0, 255, 1], 1]]);
  const [g] = ev.fills('radial-gradient(closest-side,var(--m-glow),transparent)');
  assert.deepEqual(g.kind === 'radial' && g.stops[1].color, [244, 174, 58, 0]);
});

test('shadow lists: inset, rings, glows with negative spread, and none', () => {
  assert.deepEqual(ev.shadows('none'), []);
  const s = ev.shadows('inset 0 1px 0 rgb(255 255 255/.5),0 0 0 1px #fff,0 18px 34px -24px var(--m-glow)');
  assert.deepEqual(s.map((x) => [x.inset, x.x, x.y, x.blur, x.spread]), [[true, 0, 1, 0, 0], [false, 0, 0, 0, 1], [false, 0, 18, 34, -24]]);
  assert.deepEqual(s[2].color, [244, 174, 58, 0.46]);
});

const reg = buildNativeRegistry();

test('the native fallback is Fawanees, the site default, and is registered', () => {
  assert.equal(NATIVE_FALLBACK, 'fawanees');
  assert.equal(reg.fallback, 'fawanees');
  assert.deepEqual(reg.ids, loadThemes().ids);
});

test('every theme has every material and player slot in both modes', () => {
  for (const t of reg.themes) {
    for (const m of MODES) {
      for (const k of MATERIAL_FILLS) assert.ok(t.modes[m].fills[k].length > 0, `${t.id} ${m} ${k}`);
      for (const k of MATERIAL_SHADOWS) assert.ok(Array.isArray(t.modes[m].shadows[k]), `${t.id} ${m} ${k}`);
    }
    assert.ok(t.player.fills.bar.length && t.player.fills.played.length && t.player.fills.big.length, t.id);
  }
});

test('themes keep their own shape and type', () => {
  const by = Object.fromEntries(reg.themes.map((t) => [t.id, t]));
  assert.deepEqual(by.zujaj.radius, { sm: 3, md: 6, lg: 8, xl: 12, pill: 8 });
  assert.deepEqual(by.nahas.font.latin[0], 'Source Serif 4');
  assert.deepEqual(by.nahas.font.arabic[0], 'Amiri');
  assert.equal(by.zujaj.blur?.radius, 18);
  assert.equal(by.fawanees.player.shape, -1);
});

test('gold primary-action text passes 7:1 on every stop of the primary material, in every theme and mode', () => {
  for (const t of reg.themes) {
    for (const m of MODES) {
      const d = t.modes[m];
      const text = hexOf(d.parts['button.primary.text']);
      for (const key of ['primary', 'primaryHover', 'primaryPress'] as const) {
        for (const f of d.fills[key]) {
          const colors: Rgba[] = f.kind === 'solid' ? [f.color] : f.stops.map((s) => s.color);
          for (const c of colors) {
            const ratio = contrastRatio(text, hexOf(over(c, d.colors.background)));
            assert.ok(ratio >= AA_TEXT_ON_PRIMARY, `${t.id} ${m} ${key}: ${text} on ${hexOf(c)} = ${ratio.toFixed(2)}`);
          }
        }
      }
    }
  }
});

test('player icons pass AA on the opaque base of the control bar, over black and over white video', () => {
  for (const t of reg.themes) {
    const base = t.player.fills.bar[t.player.fills.bar.length - 1];
    const c = base.kind === 'solid' ? base.color : base.stops[0].color;
    for (const video of [[0, 0, 0, 1], [255, 255, 255, 1]] as Rgba[]) {
      const ratio = contrastRatio(hexOf(t.player.colors.icon), hexOf(over(c, video)));
      assert.ok(ratio >= AA_TEXT, `${t.id}: icon on bar over ${hexOf(video)} = ${ratio.toFixed(2)}`);
    }
  }
});

test('native colours match the web tokens for the same theme and mode', () => {
  const themes = loadThemes(); const tokens = loadTokens();
  for (const t of reg.themes) {
    const model = themeModel(t.id, themes, tokens);
    for (const m of MODES) for (const c of model.themes[m]) assert.equal(hexOf(t.modes[m].colors[c.name]), c.hex, `${t.id} ${m} ${c.name}`);
  }
});

const files = generateNative(reg, themeModel('lantern', loadThemes(), loadTokens()));

test('one registry file per platform lists every theme and the fallback', () => {
  const swift = files['native/swift/FanousThemes.swift'];
  const kotlin = files['native/kotlin/net/alummahnow/fanous/FanousThemes.kt'];
  const cs = files['native/csharp/FanousThemes.cs'];
  for (const id of reg.ids) {
    assert.match(swift, new RegExp(`case ${id}\\b`));
    assert.match(kotlin, new RegExp(`${id.toUpperCase()}\\("${id}"\\)`));
    assert.match(cs, new RegExp(`case "${id}": return`));
  }
  assert.match(swift, /static let fallback: FanousThemeID = \.fawanees/);
  assert.match(kotlin, /val FALLBACK = FAWANEES/);
  assert.match(cs, /Fallback = FanousThemeId\.Fawanees/);
  for (const id of reg.ids) for (const m of ['', '-dark']) assert.ok(files[`native/gtk/${id}${m}.css`], `gtk ${id}${m}`);
});

test('resolved SVGs carry no CSS variables, and every one converts to a VectorDrawable', () => {
  const svgs = Object.entries(files).filter(([p]) => p.endsWith('.svg'));
  assert.ok(svgs.length >= 20);
  for (const [path, svg] of svgs) assert.doesNotMatch(svg, /var\(/, path);
  const vectors = Object.entries(files).filter(([p]) => p.startsWith('native/android/'));
  assert.equal(vectors.length, svgs.length);
  for (const [path, xml] of vectors) {
    assert.match(path, /^native\/android\/drawable\/fanous_[a-z]+_[a-z_]+_(light|dark)\.xml$/);
    assert.doesNotThrow(() => parseXml(xml.replace(/<\?xml[^>]*>|<!--[^>]*-->/g, '').replace('<vector', '<svg').replace('</vector>', '</svg>')), path);
  }
});

test('the converter maps shapes, transforms, opacity and gradients, and rejects what it cannot draw', () => {
  const vd = svgToVector('<svg viewBox="0 0 10 10"><defs><radialGradient id="g"><stop offset="0" stop-color="#ffffff" stop-opacity=".5"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></radialGradient></defs><g transform="translate(2 3) scale(.5)" opacity=".5"><circle cx="5" cy="5" r="2" fill="url(#g)"/><rect x="1" y="1" width="2" height="2" fill="#ff0000"/></g></svg>', 't');
  assert.match(vd, /android:translateX="2" android:translateY="3"/);
  assert.match(vd, /android:scaleX="0.5"/);
  assert.match(vd, /android:fillColor="#80FF0000"/);
  assert.match(vd, /android:type="radial" android:centerX="5" android:centerY="5" android:gradientRadius="2"/);
  assert.match(vd, /android:color="#40FFFFFF"/);
  assert.throws(() => svgToVector('<svg viewBox="0 0 1 1"><text>x</text></svg>', 't'), /unsupported element <text>/);
});
