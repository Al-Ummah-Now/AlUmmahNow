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

describe('video player chrome (transparent bar, haloed controls; both themes)', () => {
  const fg = token(playerCss, VJS_BLOCK, '--vp-fg');
  const fgMuted = token(playerCss, VJS_BLOCK, '--vp-fg-muted');
  const focus = token(playerCss, VJS_BLOCK, '--vp-focus');
  const track = token(playerCss, VJS_BLOCK, '--vp-track');
  const halo = token(playerCss, VJS_BLOCK, '--vp-halo-color');
  const outline = token(playerCss, VJS_BLOCK, '--vp-outline');
  const surface = token(playerCss, VJS_BLOCK, '--vp-surface');
  const selectedBg = token(playerCss, VJS_BLOCK, '--vp-selected-bg');
  const selectedFg = token(playerCss, VJS_BLOCK, '--vp-selected-fg');

  const rgb = (c: { r: number; g: number; b: number }) => `rgb(${c.r}, ${c.g}, ${c.b})`;
  const frames = ['#ffffff', '#000000'];

  it('control text and icons are >= 4.5:1 against their halo, even over a white frame', () => {
    const worstHalo = composite(halo, '#ffffff');
    expect(contrastRatio(fg, worstHalo)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio(fgMuted, worstHalo)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it('focus indicator is >= 3:1 against its black halo (non-text contrast)', () => {
    expect(contrastRatio(focus, '#000000')).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
  });

  it('slider tracks are >= 3:1 against their outline over white and black frames', () => {
    for (const frame of frames) {
      const trackOnFrame = composite(track, frame);
      const outlineOnFrame = composite(outline, frame);
      expect(contrastRatio(rgb(trackOnFrame), rgb(outlineOnFrame))).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
    }
  });

  it('menus (light and dark surface) and the selected item are >= 4.5:1', () => {
    const darkSurface = token(playerCss, /\.dark \.video-js \{\n([\s\S]*?)\n\}/, '--vp-surface');
    expect(contrastRatio(fg, surface)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio(fg, darkSurface)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    expect(contrastRatio(selectedFg, selectedBg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  describe('bottom scrim (worst case: smallest scrim over a pure-white frame, no halo)', () => {
    const scrim = token(playerCss, VJS_BLOCK, '--vp-scrim');
    const minHeightRem = Number(token(playerCss, VJS_BLOCK, '--vp-scrim-height').match(/([\d.]+)rem/)![1]);
    // linear-gradient(to top, <color> [stop%], ...): alpha stops from the bottom up
    const stops = Array.from(scrim.matchAll(/rgba\(0, 0, 0, ([\d.]+)\)(?:\s+([\d.]+)%)?/g)).map((m, i, all) => ({
      alpha: Number(m[1]),
      at: m[2] !== undefined ? Number(m[2]) / 100 : i / (all.length - 1),
    }));
    /** Scrim colour over a white frame at `rem` above the bottom of the player */
    const scrimOverWhiteAt = (rem: number) => {
      const f = rem / minHeightRem;
      const upper = stops.findIndex((s) => s.at >= f);
      const a = stops[upper - 1];
      const b = stops[upper];
      const alpha = a.alpha + ((b.alpha - a.alpha) * (f - a.at)) / (b.at - a.at);
      return rgb(composite(`rgba(0, 0, 0, ${alpha})`, '#ffffff'));
    };
    // Control bar: 4rem tall, controls centred at 2rem; 36px icons, ~14px text
    const BAR_CENTRE_REM = 2;

    it('is taller than the 4rem control bar', () => {
      expect(minHeightRem).toBeGreaterThan(4);
    });

    it('time and quality text are >= 4.5:1 over the whole glyph height', () => {
      for (const rem of [BAR_CENTRE_REM - 0.4375, BAR_CENTRE_REM, BAR_CENTRE_REM + 0.4375]) {
        expect(contrastRatio(fg, scrimOverWhiteAt(rem))).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      }
    });

    it('icons are >= 3:1 over their whole 36px box', () => {
      for (const rem of [BAR_CENTRE_REM - 1.125, BAR_CENTRE_REM, BAR_CENTRE_REM + 1.125]) {
        expect(contrastRatio(fg, scrimOverWhiteAt(rem))).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
      }
    });
  });

  it('menu text is >= 4.5:1 on the translucent menu surface, even over a white frame', () => {
    const menuBg = token(playerCss, VJS_BLOCK, '--vp-menu-bg');
    for (const frame of frames) {
      expect(contrastRatio(fg, rgb(composite(menuBg, frame)))).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      expect(contrastRatio(fgMuted, rgb(composite(menuBg, frame)))).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    }
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
