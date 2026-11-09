// WCAG 2.1 AA checker. Pairs come from the contrast roles in the tokens, so a new token is covered
// automatically: text-like roles are crossed with every surface.
import { rgb, type Model, type ThemeColor } from './model.ts';

export const AA_TEXT = 4.5;
export const AA_NON_TEXT = 3;
export const AA_TEXT_ON_PRIMARY = 7;

export interface Pair { theme: string; fg: string; bg: string; fgHex: string; bgHex: string; ratio: number; required: number; pass: boolean }

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function pair(theme: string, fg: ThemeColor, bg: ThemeColor, required: number): Pair {
  const ratio = contrastRatio(fg.hex, bg.hex);
  return { theme, fg: fg.name, bg: bg.name, fgHex: fg.hex, bgHex: bg.hex, ratio, required, pass: ratio >= required };
}

export function contrastPairs(model: Model): Pair[] {
  const out: Pair[] = [];
  for (const [theme, colors] of Object.entries(model.themes)) {
    const surfaces = colors.filter((c) => c.role === 'surface');
    for (const c of colors) {
      if (c.role === 'text') surfaces.forEach((s) => out.push(pair(theme, c, s, AA_TEXT)));
      if (c.role === 'nontext') surfaces.forEach((s) => out.push(pair(theme, c, s, AA_NON_TEXT)));
      if (c.role === 'on') {
        const fill = colors.find((x) => x.name === c.on);
        if (!fill) throw new Error(`${theme}.${c.name} pairs with unknown colour ${c.on}`);
        out.push(pair(theme, c, fill, AA_TEXT));
      }
    }
    for (const fill of colors.filter((c) => c.role === 'fill')) {
      if (!colors.some((c) => c.role === 'on' && c.on === fill.name)) throw new Error(`${theme}.${fill.name} has no on-colour`);
    }
  }
  return out;
}

export const contrastFailures = (model: Model) => contrastPairs(model).filter((p) => !p.pass);

/** Text on the primary action is held to 7:1 in every state a person can press. */
export const primaryTextFailures = (model: Model) => contrastPairs(model).filter((p) => ['onPrimary', 'onPrimaryHover', 'onPrimaryPressed'].includes(p.fg) && p.ratio < AA_TEXT_ON_PRIMARY);
