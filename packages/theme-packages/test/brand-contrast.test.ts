// The builder's brand swatches drive the theme, and the contrast gate refuses a palette that would
// leave text unreadable or the header light (owner report 2026-11-12: Lantern copy's light preview).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compilePackage, resolvedColors } from '../src/compile.ts';
import { brandUsage, linkBrandColors, unlinkedBrandColors } from '../src/brand-links.ts';
import { duplicatePackage } from '../src/edit.ts';
import type { ThemePackage } from '../src/types.ts';
import { validatePackage } from '../src/validate.ts';
import { BUILT_IN, THEMES_DIR, loadPackageDir } from '../scripts/load.ts';

/** The palette in the owner's screenshot: Lantern's brand colours, every role left unlinked. */
const OWNER_PALETTE = { night: '#093041', nightDeep: '#07425a', nightShallow: '#083f58', lantern: '#ffa037', glow: '#ffc46b', earth: '#8e6c53', parchment: '#f7f1e8', verified: '#16a34a', error: '#b00020' };
const lantern = () => loadPackageDir(`${THEMES_DIR}/lantern`).theme;
const copyOf = (t: ThemePackage) => duplicatePackage(t, 'lantern-copy', { en: 'Lantern copy', ar: 'نسخة الفانوس' }, 'admin@test');
const errors = (t: ThemePackage) => validatePackage(t).errors.map((e) => `${e.path}: ${e.message}`);

test('linking brand colours never changes a built-in theme\'s CSS', () => {
  for (const id of BUILT_IN.ids) {
    const { theme } = loadPackageDir(`${THEMES_DIR}/${id}`);
    const linked = linkBrandColors(theme);
    assert.equal(compilePackage(linked).css, compilePackage(theme).css, id);
    assert.equal(unlinkedBrandColors(linked), 0, id);
    assert.ok(unlinkedBrandColors(theme) > 0, id);
  }
});

test('the owner\'s palette passes the contrast gate in light and dark', () => {
  const copy = copyOf(lantern());
  assert.deepEqual(copy.tokens.brand, OWNER_PALETTE);
  assert.deepEqual(errors(copy), []);
  const light = resolvedColors(copy).light;
  // Light text comes from the night family, not the lanterns; the header stays night
  assert.equal(light.parts['nav.bg'], OWNER_PALETTE.night);
  assert.equal(light.roles.textPrimary, '#0e2b3d');
});

test('editing a brand swatch repaints what it drives: night is the header', () => {
  const copy = copyOf(lantern());
  assert.ok(brandUsage(copy).night > 0);
  copy.tokens.brand.night = '#102a43';
  const colors = resolvedColors(copy);
  assert.equal(colors.light.parts['nav.bg'], '#102a43');
  assert.match(compilePackage(copy).css, /html\[data-theme='lantern-copy'\]:not\(\.dark\) \{[^}]*--fanous-c-nav-bg: #102a43;/);
  assert.deepEqual(errors(copy), []);
});

test('a palette with light text on light surfaces is blocked', () => {
  const copy = copyOf(lantern());
  // The lanterns as light-mode text: glow on parchment fails AA
  copy.tokens.color.light.textPrimary = '{brand.glow}';
  copy.tokens.color.light.link = '{brand.lantern}';
  const errs = errors(copy);
  assert.ok(errs.some((e) => e.startsWith('tokens.color.light.textPrimary:') && /needs 4\.5:1/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => e.startsWith('tokens.color.light.link:')), errs.join('\n'));
  assert.equal(validatePackage(copy).ok, false);
});

test('a light header is blocked in either mode', () => {
  const copy = copyOf(lantern());
  copy.components.header.colors!.light.bg = '{brand.parchment}';
  copy.components.header.colors!.light.text = '{brand.night}';
  const errs = errors(copy);
  assert.ok(errs.some((e) => e.startsWith('components.header.colors.light.bg: the header is dark in every theme')), errs.join('\n'));
  const dark = copyOf(lantern());
  dark.components.header.colors!.dark.bg = '#e4d3b6';
  assert.ok(errors(dark).some((e) => e.startsWith('components.header.colors.dark.bg: the header is dark')));
});
