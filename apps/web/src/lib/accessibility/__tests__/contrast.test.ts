/**
 * Story 1.1 - pins the colour tokens used by the video player and the page
 * chrome to WCAG 2.1 AA, in both light and dark themes.
 *
 * Player colours come from each theme's player.json in fanous-tokens; page
 * colours from src/app/globals.css (:root / .dark). Both are read from disk so
 * the test cannot drift from the shipped values.
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
import { loadPlayerThemes } from '@/test/player-themes';

const globalsCss = fs.readFileSync(path.join(__dirname, '../../../app/globals.css'), 'utf8');

function token(css: string, block: RegExp, name: string): string {
  const match = css.match(block);
  if (!match) throw new Error(`block not found: ${block}`);
  const value = match[1].match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!value) throw new Error(`token not found: ${name}`);
  return value[1].trim();
}

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

describe('video player chrome: every theme in fanous-tokens', () => {
  const themes = loadPlayerThemes();

  /** `rgb(26 15 5/.96)`, `#abc`, `#aabbcc`, `transparent` -> a string parseColor accepts */
  function normalise(c: string): string {
    if (c === 'transparent') return 'rgba(0, 0, 0, 0)';
    const m = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+))?\s*\)$/);
    if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${m[4] ?? 1})`;
    return c;
  }

  /** Top-level comma split: background layers, first on top */
  function layers(value: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
      else if (value[i] === ',' && depth === 0) { out.push(value.slice(start, i)); start = i + 1; }
    }
    out.push(value.slice(start));
    return out.map((l) => l.trim());
  }

  const stops = (layer: string) => (layer.match(/#[0-9a-f]{3,6}\b|rgba?\([^)]*\)|transparent/gi) ?? []).map(normalise);

  /**
   * Every colour the surface can show: each stop of each layer, composited bottom-up over a
   * white and a black video frame. Contrast is checked against the worst of them.
   */
  function surfaceColours(value: string): string[] {
    const stack = layers(value).reverse();
    let results = ['#ffffff', '#000000'];
    for (const layer of stack) {
      const s = stops(layer);
      results = results.flatMap((below) => s.map((top) => {
        const c = composite(top, below);
        return `rgb(${c.r}, ${c.g}, ${c.b})`;
      }));
      results = [...new Set(results)];
    }
    return results;
  }

  const worst = (fg: string, bg: string) => Math.min(...surfaceColours(bg).map((b) => contrastRatio(normalise(fg), b)));

  it('covers the four demo themes', () => {
    expect(Object.keys(themes).sort()).toEqual(['fawanees', 'lantern', 'nahas', 'zujaj']);
  });

  describe.each(Object.entries(themes))('%s', (_id, t) => {
    it('settings menu text is >= 4.5:1 over a white or black frame, selected row included', () => {
      expect(worst(t.icon, t.menu)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      expect(worst(t.dim, t.menu)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      expect(worst(t.icon, `${t['menu-selected']},${t.menu}`)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      expect(worst(t.accent, `${t['menu-selected']},${t.menu}`)).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
    });

    it('tooltip, live badge and captions are >= 4.5:1', () => {
      expect(worst(t['tip-text'], t['tip-bg'])).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      expect(worst(t['live-text'], t.live)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      expect(worst(t.icon, t.cue)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    });

    it('the big play icon and the focus ring are >= 3:1 (non-text)', () => {
      expect(worst(t['big-icon'], t.big)).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
      expect(worst(t.accent, t.menu)).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
    });

    it('error panel text is >= 4.5:1', () => {
      expect(worst(t.icon, t.err)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      expect(worst(t.dim, t.err)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    });
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
