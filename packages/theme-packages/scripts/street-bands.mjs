// Draws the Fawanees street bands: two tall image tiles (the left and the right side of the page)
// of strings with lit lanterns, made to repeat vertically with no seam (repeat-y). Run once when
// the art changes; the WebP files are committed:
//   node packages/theme-packages/scripts/street-bands.mjs   (needs @playwright/test and cwebp)
// The lantern is the street's lantern art, unchanged (the same drawing prod's street uses); only
// its size changes. Strings run off the page edge and fade out towards the content.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = join(ROOT, 'packages/theme-packages/themes/fawanees/assets');
const require = createRequire(join(ROOT, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

/** Tile size in CSS pixels (rendered at 2x). Tall, with uneven rows, so the repeat is hard to spot. */
const W = 280;
/** Each side its own height, so the two sides line up again only after many screens. */
const HEIGHTS = { left: 1560, right: 1430 };
let H = HEIGHTS.left;
const LANTERN = '<circle cx="0" cy="4" r="3"/><path d="M0 7V12"/><path d="M-14 34C-18 24-6 20 0 12C6 20 18 24 14 34Z"/><path d="M-17 34H17V38H-17Z"/><path d="M-15 38H15L18 44V74L15 80H-15L-18 74V44Z"/><path class="w" d="M-5 74V55C-5 50-1 49 0 45C1 49 5 50 5 55V74Z"/><path class="w" d="M-14 73V58C-14 55-12 54-11 51C-10 54-9 55-9 58V73Z"/><path class="w" d="M14 73V58C14 55 12 54 11 51C10 54 9 55 9 58V73Z"/><path d="M-17 80H17L12 88H-12Z"/><path d="M-4 88L0 96L4 88"/>';
/** The street's colours per mode (the theme's street tokens; dark is prod's lit look). */
const MODES = {
  dark: { line: '#f5cf92', lineA: 0x42 / 255, win: '#fbc661', winA: 0xb8 / 255, glow: '#f4ae3a', glowA: 0.6 },
  light: { line: '#dfd4c8', lineA: 1, win: '#f4ae3a', winA: 0x4d / 255, glow: '#f4ae3a', glowA: 0.1 },
};

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The rows of one side: uneven spacing that adds up to exactly H, so the tile closes on itself. */
function rows(side) {
  const rnd = seeded(side === 'left' ? 0x51f15e : 0xa3c09d);
  const r = (lo, hi) => lo + (hi - lo) * rnd();
  const gaps = [];
  while (gaps.reduce((a, b) => a + b, 0) < H - 260) gaps.push(r(175, 255));
  const scale = H / gaps.reduce((a, b) => a + b, 0);
  let y = r(20, 90);
  return gaps.map((g) => {
    const row = { y, sag: r(7, 17), lift: r(-5, 5) };
    // Lanterns: one to three, never evenly spaced, each with its own size and drop
    const n = rnd() < 0.2 ? 1 : rnd() < 0.75 ? 2 : 3;
    const xs = [];
    for (let i = 0; i < 40 && xs.length < n; i++) {
      const t = r(0.12, 0.82);
      if (xs.every((u) => Math.abs(u - t) * W > 58)) xs.push(t);
    }
    row.lanterns = xs.sort().map((t) => ({ t, h: r(36, 50), cord: r(5, 30) }));
    y += g * scale;
    return row;
  });
}

const f = (n) => n.toFixed(1);

/** One row drawn at a vertical offset (the tile draws every row three times: -H, 0, +H). */
function rowSvg(row, side, dy) {
  // The string: from beyond the page edge to its inner end (which fades out)
  const outer = side === 'left' ? -12 : W + 12, inner = side === 'left' ? W - 16 : 16;
  const y0 = row.y + dy, y1 = y0 + row.lift;
  const at = (t) => y0 + (y1 - y0) * t + row.sag * 4 * t * (1 - t);
  const xAt = (t) => outer + (inner - outer) * t;
  let out = `<path class="s" d="M${f(outer)} ${f(y0)}Q${f((outer + inner) / 2)} ${f((y0 + y1) / 2 + row.sag * 2)} ${f(inner)} ${f(y1)}"/>`;
  for (let t = 0.03; t < 0.97; t += 22 / Math.abs(inner - outer)) out += `<circle class="b" cx="${f(xAt(t))}" cy="${f(at(t) + 2.5)}" r="1.6"/>`;
  for (const l of row.lanterns) {
    const x = xAt(l.t), top = at(l.t), y = top + l.cord, sc = l.h / 100;
    out += `<circle cx="${f(x)}" cy="${f(y + 62 * sc)}" r="${f(30 * sc)}" fill="url(#g)" class="glow"/>`
      + `<path class="c" d="M${f(x)} ${f(top)}V${f(y)}"/>`
      + `<use href="#lantern" x="${f(x - 24 * sc)}" y="${f(y)}" width="${f(48 * sc)}" height="${f(100 * sc)}"/>`;
  }
  return out;
}

function tileSvg(side, c) {
  const body = rows(side).map((row) => [-H, 0, H].map((dy) => rowSvg(row, side, dy)).join('')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="g"><stop offset="0" stop-color="${c.glow}"/><stop offset="1" stop-color="${c.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="fade" gradientUnits="userSpaceOnUse" ${side === 'left' ? `x1="0" x2="${W}"` : `x1="${W}" x2="0"`} y1="0" y2="0"><stop offset="0" stop-color="${c.line}" stop-opacity="${c.lineA}"/><stop offset=".86" stop-color="${c.line}" stop-opacity="${c.lineA}"/><stop offset="1" stop-color="${c.line}" stop-opacity="0"/></linearGradient>
<symbol id="lantern" viewBox="-24 0 48 100" overflow="visible">${LANTERN}</symbol>
</defs>
<style>
.glow{opacity:${c.glowA};stroke:none}
.s{fill:none;stroke:url(#fade);stroke-width:1.5}
.b{fill:none;stroke:${c.line};stroke-opacity:${c.lineA};stroke-width:1.5}
.c,use{fill:none;stroke:${c.line};stroke-opacity:${c.lineA};stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.w{fill:${c.win};fill-opacity:${c.winA};stroke:${c.line}}
</style>
${body}
</svg>`;
}

const tmp = join(tmpdir(), `street-bands-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
for (const side of ['left', 'right']) {
  H = HEIGHTS[side];
  await page.setViewportSize({ width: W, height: H });
  for (const [mode, c] of Object.entries(MODES)) {
    const svg = tileSvg(side, c);
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    const png = join(tmp, `${side}-${mode}.png`);
    await page.screenshot({ path: png, omitBackground: true, clip: { x: 0, y: 0, width: W, height: H } });
    const name = `street-band-${side}${mode === 'dark' ? '-dark' : ''}.webp`;
    execFileSync('cwebp', ['-quiet', '-q', '88', '-alpha_q', '100', '-m', '6', png, '-o', join(OUT, name)]);
    writeFileSync(join(tmp, `${side}-${mode}.svg`), svg);
    console.log(name);
  }
}
await browser.close();
console.log('tmp:', tmp);
