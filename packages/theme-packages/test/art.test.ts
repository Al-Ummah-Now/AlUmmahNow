// Each theme's art (imagery.headerGraphic) compiled per mode with the theme's own colours: an SVG
// drawn as an image cannot read the page's custom properties, so they are written in.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compilePackage, compiledArt, resolvedColors } from '../src/compile.ts';
import { BUILT_IN, THEMES_DIR, loadPackageDir, svgTextOf } from '../scripts/load.ts';
import type { ThemePackage } from '../src/types.ts';

const load = (id: string) => loadPackageDir(`${THEMES_DIR}/${id}`);

test('every built-in theme has art for both modes, with no page variable left in it', () => {
  for (const id of BUILT_IN.ids) {
    const files = load(id);
    for (const mode of ['dark', 'light'] as const) {
      const art = compiledArt(files.theme, mode, svgTextOf(files));
      assert.ok(art, `${id} ${mode} has art`);
      assert.equal(art.tiled, false, `${id} uses its header graphic`);
      assert.doesNotMatch(art.svg, /var\(/, `${id} ${mode}`);
      assert.match(art.svg, /^<svg[\s>]/);
    }
  }
});

test('the colours written in are the theme\'s own for that mode', () => {
  const files = load('fawanees');
  const colors = resolvedColors(files.theme);
  const dark = compiledArt(files.theme, 'dark', svgTextOf(files))!.svg;
  const light = compiledArt(files.theme, 'light', svgTextOf(files))!.svg;
  assert.ok(dark.includes(colors.dark.roles.primary), 'dark primary');
  assert.ok(light.includes(colors.light.roles.textPrimary), 'light text');
});

test('the art is scoped to the theme and mode; uploaded packages carry it inline', () => {
  const files = load('nahas');
  const theme = { ...files.theme, id: 'my-theme', kind: 'custom' } as ThemePackage;
  const { art, css } = compilePackage(theme, { svgText: svgTextOf(files) });
  assert.match(art, /html\[data-theme='my-theme'\]\.dark \{\n {2}--fanous-header-graphic: url\("data:image\/svg\+xml,%3Csvg/);
  assert.match(art, /html\[data-theme='my-theme'\]:not\(\.dark\) \{\n {2}--fanous-header-graphic: url\("data:image\/svg\+xml,/);
  assert.ok(css.endsWith(art), 'the art is part of the served CSS');
  assert.doesNotMatch(art, /[<>"]svg/, 'encoded, so it cannot leave the url("…")');
});

test('a package without a header graphic uses its pattern, tiled; with neither the art is none', () => {
  const files = load('fawanees');
  const noHeader = { ...files.theme, imagery: { ...files.theme.imagery, headerGraphic: undefined } } as unknown as ThemePackage;
  const pattern = compiledArt(noHeader, 'dark', svgTextOf(files));
  assert.equal(pattern?.tiled, true);
  assert.match(compilePackage(noHeader, { svgText: svgTextOf(files) }).art, /--fanous-header-graphic-repeat: repeat;/);
  const bare = { ...noHeader, imagery: { ...noHeader.imagery, pattern: 'none' } } as unknown as ThemePackage;
  assert.match(compilePackage(bare, { svgText: svgTextOf(files) }).art, /--fanous-header-graphic: none;/);
  // No asset text (a compile that cannot read files): none, never a raw SVG with unresolved colours
  assert.match(compilePackage(files.theme).art, /--fanous-header-graphic: none;/);
});
