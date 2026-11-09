// Evaluates the CSS values in material.json and player.json into plain data a native renderer can draw:
// colours become RGBA, gradients become stops with resolved positions, shadow lists become offsets.
// `var()` resolves against the theme's colours for one mode, so each theme and mode yields fixed values.

export type Rgba = [number, number, number, number];
export interface Stop { color: Rgba; at: number }
/** `angle` follows CSS: 0deg points up, 90deg points right. `logical` gradients mirror in right-to-left. */
export interface Linear { kind: 'linear'; angle: number; logical: boolean; stops: Stop[] }
/**
 * `size` is either explicit radii as fractions of the box (rx of width, ry of height), or a CSS extent keyword.
 * `cx`, `cy` are fractions of the box. `logicalX` means cx is measured from the start edge.
 */
export interface Radial {
  kind: 'radial';
  shape: 'ellipse' | 'circle';
  size: { rx: number; ry: number } | 'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner';
  cx: number; cy: number; logicalX: boolean;
  stops: Stop[];
}
export interface Solid { kind: 'solid'; color: Rgba }
export type Fill = Linear | Radial | Solid;
export interface Shadow { inset: boolean; x: number; y: number; blur: number; spread: number; color: Rgba }

/** Looks up a custom property by name (without the leading `--`), or undefined when it is not known. */
export type Lookup = (name: string) => string | undefined;

const NAMED: Record<string, Rgba> = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1] };

/** Splits on a separator outside parentheses and quotes. */
export function splitTop(value: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0; let quote = ''; let cur = '';
  for (const ch of value) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    const isSep = sep === ' ' ? /\s/.test(ch) : ch === sep;
    if (isSep && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const fn = (s: string): { name: string; args: string } | undefined => {
  const m = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(s.trim());
  return m ? { name: m[1].toLowerCase(), args: m[2] } : undefined;
};

function hexColor(s: string): Rgba | undefined {
  const m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (!m) return undefined;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return undefined;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1];
}

const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

export class CssEvaluator {
  private readonly lookup: Lookup;
  private readonly where: string;

  constructor(lookup: Lookup, where = 'value') {
    this.lookup = lookup;
    this.where = where;
  }

  private fail(msg: string): never { throw new Error(`${this.where}: ${msg}`); }

  /** Replaces `var(--x)` with its value, so the rest of the parser only sees literals. */
  expand(value: string, seen: string[] = []): string {
    return value.replace(/var\(\s*--([a-z0-9-]+)\s*\)/gi, (_, name: string) => {
      if (seen.includes(name)) this.fail(`circular var(--${name})`);
      const v = this.lookup(name);
      if (v === undefined) this.fail(`unknown var(--${name})`);
      return this.expand(v, [...seen, name]);
    });
  }

  color(raw: string): Rgba {
    const s = this.expand(raw).trim();
    const named = NAMED[s.toLowerCase()];
    if (named) return [...named] as Rgba;
    const hex = hexColor(s);
    if (hex) return hex;
    const f = fn(s);
    if (f?.name === 'rgb' || f?.name === 'rgba') {
      const [rgbPart, alphaPart] = f.args.includes('/') ? f.args.split('/') : [f.args, undefined];
      const nums = splitTop(rgbPart.replace(/,/g, ' '), ' ').map(Number);
      const parts = f.args.includes('/') ? nums : nums.slice(0, 3);
      const a = alphaPart !== undefined ? this.alpha(alphaPart) : nums.length === 4 ? nums[3] : 1;
      if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) this.fail(`bad colour ${s}`);
      return [parts[0], parts[1], parts[2], a];
    }
    if (f?.name === 'color-mix') return this.mix(f.args);
    return this.fail(`unsupported colour "${s}"`);
  }

  private alpha(s: string): number {
    const t = s.trim();
    return t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t);
  }

  /** `color-mix(in srgb, A p%, B [q%])`, with CSS's premultiplied interpolation and normalised weights. */
  private mix(args: string): Rgba {
    const [space, a, b] = splitTop(args, ',');
    if (space.trim() !== 'in srgb') this.fail(`color-mix must be in srgb, got "${space}"`);
    const part = (p: string) => {
      const bits = splitTop(p, ' ');
      const pct = bits.length > 1 && bits[bits.length - 1].endsWith('%') ? Number(bits.pop()!.slice(0, -1)) / 100 : undefined;
      return { color: this.color(bits.join(' ')), pct };
    };
    const A = part(a); const B = part(b);
    let pa = A.pct; let pb = B.pct;
    if (pa === undefined && pb === undefined) { pa = 0.5; pb = 0.5; }
    else if (pa === undefined) pa = 1 - pb!;
    else if (pb === undefined) pb = 1 - pa;
    const sum = pa + pb!;
    const scale = sum < 1 ? sum : 1;
    const wa = pa / sum; const wb = pb! / sum;
    const alpha = A.color[3] * wa + B.color[3] * wb;
    const channel = (i: number) => (alpha === 0 ? 0 : (A.color[i] * A.color[3] * wa + B.color[i] * B.color[3] * wb) / alpha);
    return [round(channel(0), 2), round(channel(1), 2), round(channel(2), 2), round(alpha * scale)];
  }

  private stops(list: string[]): Stop[] {
    const raw = list.map((s) => {
      const bits = splitTop(s, ' ');
      const pos = bits.length > 1 && /%$/.test(bits[bits.length - 1]) ? Number(bits.pop()!.slice(0, -1)) / 100 : undefined;
      return { color: this.color(bits.join(' ')), at: pos };
    });
    if (raw.length < 2) this.fail('a gradient needs two stops');
    // CSS: first defaults to 0, last to 1, positions never go back, gaps are spread evenly.
    if (raw[0].at === undefined) raw[0].at = 0;
    if (raw[raw.length - 1].at === undefined) raw[raw.length - 1].at = 1;
    let max = 0;
    for (const r of raw) if (r.at !== undefined) { r.at = Math.max(r.at, max); max = r.at; }
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].at !== undefined) continue;
      let j = i; while (raw[j].at === undefined) j++;
      const from = raw[i - 1].at!; const to = raw[j].at!;
      for (let k = i; k < j; k++) raw[k].at = from + ((to - from) * (k - i + 1)) / (j - i + 1);
    }
    return premultiplied(raw.map((r) => ({ color: r.color, at: round(r.at!) })));
  }

  private linear(args: string): Linear {
    const parts = splitTop(args, ',');
    const head = parts[0].trim();
    let angle = 180; let logical = false; let body = parts;
    if (/^-?\d+(\.\d+)?deg$/.test(head)) { angle = Number(head.slice(0, -3)); body = parts.slice(1); }
    else if (/^to /.test(head)) {
      const dirs: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };
      if (head === 'to end') { angle = 90; logical = true; }
      else if (dirs[head] !== undefined) angle = dirs[head];
      else this.fail(`unsupported direction "${head}"`);
      body = parts.slice(1);
    }
    return { kind: 'linear', angle, logical, stops: this.stops(body) };
  }

  private radial(args: string): Radial {
    const parts = splitTop(args, ',');
    const head = parts[0].trim();
    const isStop = (() => { try { this.color(splitTop(head, ' ')[0]); return true; } catch { return false; } })();
    let shape: Radial['shape'] = 'ellipse'; let size: Radial['size'] = 'farthest-corner'; let cx = 0.5; let cy = 0.5; let logicalX = false;
    let body = parts;
    if (!isStop) {
      body = parts.slice(1);
      const [sizePart, posPart] = head.includes(' at ') ? head.split(' at ') : head.startsWith('at ') ? ['', head.slice(3)] : [head, ''];
      const sizeBits = splitTop(sizePart, ' ').filter((b) => {
        if (b === 'circle' || b === 'ellipse') { shape = b; return false; }
        return true;
      });
      if (sizeBits.length === 1 && /^(closest|farthest)-(side|corner)$/.test(sizeBits[0])) size = sizeBits[0] as Radial['size'];
      else if (sizeBits.length === 2 && sizeBits.every((b) => b.endsWith('%'))) size = { rx: Number(sizeBits[0].slice(0, -1)) / 100, ry: Number(sizeBits[1].slice(0, -1)) / 100 };
      else if (sizeBits.length) this.fail(`unsupported radial size "${sizePart}"`);
      if (posPart) {
        const [x, y = '50%'] = splitTop(posPart, ' ');
        if (x === 'start') { cx = 0; logicalX = true; }
        else if (x === 'end') { cx = 1; logicalX = true; }
        else if (x.endsWith('%')) cx = Number(x.slice(0, -1)) / 100;
        else this.fail(`unsupported radial position "${posPart}"`);
        if (!y.endsWith('%')) this.fail(`unsupported radial position "${posPart}"`);
        cy = Number(y.slice(0, -1)) / 100;
      }
    }
    return { kind: 'radial', shape, size, cx: round(cx), cy: round(cy), logicalX, stops: this.stops(body) };
  }

  /** A background: one or more layers, topmost first, as in CSS. */
  fills(raw: string): Fill[] {
    // Logical directions are written with the demo's custom properties; keep them logical here.
    const value = raw.replace(/var\(--to-end\)/g, 'to end').replace(/at var\(--from\)/g, 'at start');
    return splitTop(this.expand(value), ',').map((layer) => {
      const f = fn(layer);
      if (f?.name === 'linear-gradient') return this.linear(f.args);
      if (f?.name === 'radial-gradient') return this.radial(f.args);
      return { kind: 'solid', color: this.color(layer) } as Solid;
    });
  }

  /** A box-shadow list; `none` is empty. */
  shadows(raw: string): Shadow[] {
    const value = this.expand(raw).trim();
    if (value === 'none') return [];
    return splitTop(value, ',').map((s) => {
      const bits = splitTop(s, ' ');
      const inset = bits[0] === 'inset';
      if (inset) bits.shift();
      const lengths: number[] = [];
      while (bits.length && /^-?\d+(\.\d+)?(px)?$/.test(bits[0])) lengths.push(Number(bits.shift()!.replace('px', '')));
      if (lengths.length < 2) this.fail(`bad shadow "${s}"`);
      const [x, y, blur = 0, spread = 0] = lengths;
      return { inset, x, y, blur, spread, color: this.color(bits.join(' ')) };
    });
  }

  length(raw: string): number {
    const m = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(raw.trim());
    if (!m) this.fail(`expected a px length, got "${raw}"`);
    return Number(m[1]);
  }

  /** `8px 12px 2px` → top, end, bottom, start (CSS shorthand). */
  box(raw: string): [number, number, number, number] {
    const v = splitTop(raw, ' ').map((b) => this.length(b));
    const [t, r = t, b = t, l = r] = v;
    return [t, r, b, l];
  }
}

/**
 * CSS interpolates gradients with premultiplied alpha, so a fade to `transparent` keeps its hue. Native
 * gradients interpolate plain RGBA, so a fully transparent stop takes its neighbour's colour (split in two
 * when the neighbours differ). The rendered result then matches the web.
 */
export function premultiplied(stops: Stop[]): Stop[] {
  const out: Stop[] = [];
  stops.forEach((s, i) => {
    if (s.color[3] !== 0) return void out.push(s);
    const left = stops.slice(0, i).reverse().find((x) => x.color[3] !== 0);
    const right = stops.slice(i + 1).find((x) => x.color[3] !== 0);
    const tint = (c: Rgba | undefined): Rgba => (c ? [c[0], c[1], c[2], 0] : s.color);
    const l = tint(left?.color); const r = tint(right?.color);
    if (left && right && l.slice(0, 3).join() !== r.slice(0, 3).join()) out.push({ color: l, at: s.at }, { color: r, at: s.at });
    else out.push({ color: left ? l : r, at: s.at });
  });
  return out;
}

export const hexOf =([r, g, b]: Rgba) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Composites a colour over an opaque background (for contrast checks of translucent fills). */
export function over([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}
