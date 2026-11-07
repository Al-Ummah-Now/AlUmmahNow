/**
 * WCAG 2.1 colour contrast helpers (Story 1.1)
 *
 * Used by the unit tests that pin the player/page colour tokens to WCAG AA,
 * and available to components that need to pick a readable foreground.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** WCAG 2.1 AA thresholds */
export const WCAG_AA_NORMAL_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;
export const WCAG_AA_NON_TEXT = 3;

/** Parse #rgb, #rrggbb or rgba()/rgb() into channels (0-255, alpha 0-1). */
export function parseColor(input: string): Rgba {
  const value = input.trim().toLowerCase();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (fn) {
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) };
  }
  throw new Error(`Unsupported colour: ${input}`);
}

/** Alpha-composite `top` over an opaque `bottom` colour. */
export function composite(top: string, bottom: string): Rgba {
  const t = parseColor(top);
  const b = parseColor(bottom);
  const mix = (ft: number, fb: number) => Math.round(ft * t.a + fb * (1 - t.a));
  return { r: mix(t.r, b.r), g: mix(t.g, b.g), b: mix(t.b, b.b), a: 1 };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: string | Rgba): number {
  const { r, g, b } = typeof color === 'string' ? parseColor(color) : color;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio (1-21) between two opaque colours. */
export function contrastRatio(a: string | Rgba, b: string | Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
