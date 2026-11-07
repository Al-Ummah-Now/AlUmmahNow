/**
 * Story 1.1 - pins the colour tokens used by the video player and the page
 * chrome to WCAG 2.1 AA, in both light and dark themes.
 *
 * The values mirror the tokens in src/styles/video-player.css (.video-js) and
 * src/app/globals.css (:root / .dark). The CSS-token test below reads those
 * files so the two cannot drift apart silently.
 */
import fs from 'fs';
import path from 'path';
import {
  composite,
  contrastRatio,
  parseColor,
  WCAG_AA_NON_TEXT,
  WCAG_AA_NORMAL_TEXT,
} from '../contrast';

const playerCss = fs.readFileSync(path.join(__dirname, '../../../styles/video-player.css'), 'utf8');
const globalsCss = fs.readFileSync(path.join(__dirname, '../../../app/globals.css'), 'utf8');

function token(css: string, block: RegExp, name: string): string {
  const match = css.match(block);
  if (!match) throw new Error(`block not found: ${block}`);
  const value = match[1].match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!value) throw new Error(`token not found: ${name}`);
  return value[1].trim();
}

const VJS_BLOCK = /\n\.video-js \{\n([\s\S]*?)\n\}/;
const ROOT_A11Y = /:root \{\n(\s+--a11y-focus-ring[\s\S]*?)\n\}/;
const DARK_A11Y = /\.dark \{\n(\s+--a11y-focus-ring[\s\S]*?)\n\}/;

describe('contrast helpers', () => {
  it('computes known WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('parses rgba and composites over a background', () => {
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(composite('rgba(0, 0, 0, 0.72)', '#ffffff')).toEqual({ r: 71, g: 71, b: 71, a: 1 });
  });
});

describe('video player chrome (both themes share the dark scrim)', () => {
  const fg = token(playerCss, VJS_BLOCK, '--vp-fg');
  const fgMuted = token(playerCss, VJS_BLOCK, '--vp-fg-muted');
  const focus = token(playerCss, VJS_BLOCK, '--vp-focus');
  const track = token(playerCss, VJS_BLOCK, '--vp-track');
  const scrimWeak = token(playerCss, VJS_BLOCK, '--vp-scrim-weak');
  const surface = token(playerCss, VJS_BLOCK, '--vp-surface');
  const selectedBg = token(playerCss, VJS_BLOCK, '--vp-selected-bg');
  const selectedFg = token(playerCss, VJS_BLOCK, '--vp-selected-fg');

  // Worst case for light controls: the most transparent part of the scrim over a white frame
  const worstScrim = composite(scrimWeak, '#ffffff');

  it('control text and icons are >= 4.5:1 over the worst-case frame', () => {
    expect(contrastRatio(fg, worstScrim)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio(fgMuted, worstScrim)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it('focus indicator is >= 3:1 against the scrim (non-text contrast)', () => {
    expect(contrastRatio(focus, worstScrim)).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
    expect(contrastRatio(focus, '#000000')).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
  });

  it('slider tracks are >= 3:1 against the scrim (non-text contrast)', () => {
    const trackOnScrim = composite(track, `rgb(${worstScrim.r}, ${worstScrim.g}, ${worstScrim.b})`);
    expect(contrastRatio(trackOnScrim, worstScrim)).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
  });

  it('menus (light and dark surface) and the selected item are >= 4.5:1', () => {
    const darkSurface = token(playerCss, /\.dark \.video-js \{\n([\s\S]*?)\n\}/, '--vp-surface');
    expect(contrastRatio(fg, surface)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio(fg, darkSurface)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio(selectedFg, selectedBg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it('no longer uses the invalid oklch(var(--token)) form that dropped the declarations', () => {
    expect(playerCss).not.toMatch(/oklch\(var\(/);
  });
});

describe('page focus indicator tokens', () => {
  it('light theme ring is >= 4.5:1 on white and >= 3:1 against its halo', () => {
    const ring = token(globalsCss, ROOT_A11Y, '--a11y-focus-ring');
    const halo = token(globalsCss, ROOT_A11Y, '--a11y-focus-halo');
    expect(contrastRatio(ring, '#ffffff')).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio(ring, halo)).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
  });

  it('dark theme ring is >= 4.5:1 on gray-900 and >= 3:1 against its halo', () => {
    const ring = token(globalsCss, DARK_A11Y, '--a11y-focus-ring');
    const halo = token(globalsCss, DARK_A11Y, '--a11y-focus-halo');
    expect(contrastRatio(ring, '#101828')).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio(ring, halo)).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
  });

  it('skip links are readable in both themes', () => {
    for (const block of [ROOT_A11Y, DARK_A11Y]) {
      const bg = token(globalsCss, block, '--a11y-skip-bg');
      const fg = token(globalsCss, block, '--a11y-skip-fg');
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
  });
});
