// Draws the Fawanees street tile: one wide image of lantern strings that repeats in both directions
// with no seam, painted behind the whole page (centred, repeat). Run once when the art changes;
// the WebP files are committed:
//   node packages/theme-packages/scripts/street-tile.mjs   -> street-tile[-dark]-<n>.webp (needs @playwright/test and cwebp)
// - Every row is one string from the tile's left edge to its right edge, tied at uneven hang
//   points; the string leaves the right edge at the height it enters on the left, so rows run on
//   across tiles. Row spacing is uneven and adds up to the tile height, and every row is drawn
//   again one tile up and down, so the vertical seam does not show either.
// - Lanterns (the street's lantern art, unchanged; only resized) hang along the whole string,
//   across the full width, at uneven gaps with uneven drops and sizes, like a street hung by hand;
//   posts and cards simply cover whatever is behind them.
// - VARIANTS tiles per mode (each its own street); the page picks one at random before first
//   paint (fanous-street.js STREET_VARIANT_SCRIPT), and only that one downloads.
// - Drawn at 2x, shown at its CSS size by image-set(… 2x): never stretched.
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = join(ROOT, 'packages/theme-packages/themes/fawanees/assets');
const require = createRequire(join(ROOT, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

/** Tile size in CSS pixels: as wide as a large desktop, tall enough that the repeat is hard to spot. */
const W = 1920, H = 1560;
/** Gap between neighbouring lanterns along a string, picked at random in this range. */
const GAP = [90, 270];
/** How many variants to draw; the page picks one at random before first paint. */
const VARIANTS = 4;
/** No lantern (with its glow) hangs closer than this to the tile's left or right edge. */
const EDGE = 32;
/** Per-file weight budget: one variant downloads per load, no heavier than the single tile was. */
const MAX_BYTES = 300_000;
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

/** The rows: uneven spacing that adds up to exactly H; each row's hang points, swags and lanterns. */
function rows(seed) {
  const rnd = seeded(seed);
  const r = (lo, hi) => lo + (hi - lo) * rnd();
  const gaps = [];
  while (gaps.reduce((a, b) => a + b, 0) < H - 250) gaps.push(r(185, 255));
  const scale = H / gaps.reduce((a, b) => a + b, 0);
  let y = r(30, 80);
  return gaps.map((g) => {
    // Hang points laid around the tile's width as a circle, so the tile wraps like a cylinder:
    // the last swag runs from the last hang point across the right edge to the first hang point
    // one tile over. The edge falls in the middle of that one curve, so the string leaves the
    // right edge at the height and slope it enters on the left (no kink, no tie point at the edge).
    const n = Math.round(W / 320);
    const gaps = Array.from({ length: n }, () => r(240, 400));
    const k = W / gaps.reduce((s, v) => s + v, 0);
    const pts = [];
    let x = r(80, 300);
    for (const gap of gaps) { pts.push({ x, y: y + r(-7, 7) }); x += gap * k; }
    const swags = pts.map((p, i) => ({
      a: p,
      b: i < n - 1 ? pts[i + 1] : { x: pts[0].x + W, y: pts[0].y },
      sag: r(8, 18),
    }));
    /** The string's top at x (0 <= x < W), on the swag that holds it (the wrap swag left of pts[0]). */
    const at = (x) => {
      const xx = x < pts[0].x ? x + W : x;
      const { a, b, sag } = swags.find((w) => xx >= w.a.x && xx < w.b.x);
      const t = (xx - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t + sag * 4 * t * (1 - t);
    };
    // Lanterns along the whole string, hung by hand: uneven gaps, drops and sizes. None hangs
    // within EDGE of the left or right edge (so none is drawn in halves), and the gap that runs
    // across the edge into the next tile is no shorter than the others.
    const lanterns = [];
    const xs = [EDGE + r(0, GAP[1] - GAP[0])];
    while (true) {
      const next = xs[xs.length - 1] + r(GAP[0], GAP[1]);
      if (next > W - EDGE || W - next + xs[0] < GAP[0]) break;
      xs.push(next);
    }
    for (const lx of xs) {
      const top = at(lx);
      lanterns.push({ x: lx, top, y: top + r(4, 42), h: r(32, 54) });
    }
    y += g * scale;
    return { swags, lanterns };
  });
}

const f = (n) => n.toFixed(1);

/** One row at an offset (every row is drawn nine times: the tile and its eight neighbours). */
function rowSvg(row, dx, dy) {
  let d = '', bulbs = '', lamps = '';
  for (const { a, b, sag } of row.swags) {
    const ax = a.x + dx, ay = a.y + dy, bx = b.x + dx, by = b.y + dy;
    if (!d) d = `M${f(ax)} ${f(ay)}`;
    d += `Q${f((ax + bx) / 2)} ${f((ay + by) / 2 + sag * 2)} ${f(bx)} ${f(by)}`;
    // Bulbs: evenly along each swag, clear of its hang points (so the edges match tile to tile)
    const n = Math.max(1, Math.round((bx - ax) / 22));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      bulbs += `<circle class="b" cx="${f(ax + (bx - ax) * t)}" cy="${f(ay + (by - ay) * t + sag * 4 * t * (1 - t) + 2.5)}" r="1.6"/>`;
    }
  }
  for (const l of row.lanterns) {
    const x = l.x + dx, top = l.top + dy, y = l.y + dy, sc = l.h / 100;
    lamps += `<circle cx="${f(x)}" cy="${f(y + 62 * sc)}" r="${f(30 * sc)}" fill="url(#g)" class="glow"/>`
      + `<path class="c" d="M${f(x)} ${f(top)}V${f(y)}"/>`
      + `<use href="#lantern" x="${f(x - 24 * sc)}" y="${f(y)}" width="${f(48 * sc)}" height="${f(100 * sc)}"/>`;
  }
  return `<path class="s" d="${d}"/>${bulbs}${lamps}`;
}

function tileSvg(c, seed) {
  const all = rows(seed);
  let body = '';
  for (const dy of [-H, 0, H]) for (const dx of [-W, 0, W]) for (const row of all) body += rowSvg(row, dx, dy);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="g"><stop offset="0" stop-color="${c.glow}"/><stop offset="1" stop-color="${c.glow}" stop-opacity="0"/></radialGradient>
<symbol id="lantern" viewBox="-24 0 48 100" overflow="visible">${LANTERN}</symbol>
</defs>
<style>
.glow{opacity:${c.glowA};stroke:none}
.s,.b,.c,use{fill:none;stroke:${c.line};stroke-opacity:${c.lineA};stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.w{fill:${c.win};fill-opacity:${c.winA};stroke:${c.line}}
</style>
${body}
</svg>`;
}

const tmp = join(tmpdir(), `street-tile-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
for (let v = 1; v <= VARIANTS; v++) {
  // Same seed for both modes: the light and dark tiles of a variant hang the same street
  const seed = 0x5f7ee7 + v * 0x9e3779b1;
  for (const [mode, c] of Object.entries(MODES)) {
    await page.setContent(`<html><body style="margin:0;background:transparent">${tileSvg(c, seed)}</body></html>`);
    const png = join(tmp, `${mode}-${v}.png`);
    await page.screenshot({ path: png, omitBackground: true, clip: { x: 0, y: 0, width: W, height: H } });
    const lowest = Math.max(...rows(seed).flatMap((row) => row.lanterns.map((l) => l.y + l.h + 16)));
    if (lowest > H) throw new Error(`variant ${v}: a lantern crosses the bottom edge (${lowest.toFixed(0)} > ${H})`);
    const name = `street-tile${mode === 'dark' ? '-dark' : ''}-${v}.webp`;
    // Highest quality that keeps the file within the per-load budget (one variant downloads per load)
    const out = join(OUT, name);
    let q = Number(process.env.Q || 85);
    do {
      execFileSync('cwebp', ['-quiet', '-q', String(q), '-alpha_q', '100', '-m', '6', png, '-o', out]);
      q -= 5;
    } while (statSync(out).size > MAX_BYTES && q >= 60);
    if (statSync(out).size > MAX_BYTES) throw new Error(`${name} is over ${MAX_BYTES} bytes even at q60`);
    console.log(name, `q${q + 5}`, statSync(out).size);
  }
}
await browser.close();
