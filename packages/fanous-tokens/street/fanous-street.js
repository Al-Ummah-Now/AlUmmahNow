// Fanous lantern street: the shared module every Al Ummah Now app includes (videos, admin, www,
// CMS, sign-in, profile, accounts admin). Plain JavaScript, no dependencies, so other repos can
// vendor this file as is (with fanous-street.css).
//
// The theme decides: the active theme's tokens set --fanous-street-on to 1 (theme package
// `street` section, Fawanees). The street is then the page background, one continuous scene down
// the whole page, behind every element:
//   - near: a building edge down each side of the window, and from bracket to bracket across the
//     page one string per row, tied at a few hang points, with whole lanterns hanging from it.
//     Every row takes its spacing, hang points, sag, lantern sizes and drops from its own seeded
//     random numbers, so no block ever repeats, and the same page always draws the same street.
//     It is one static drawing in the page (it scrolls with the page; nothing runs on scroll).
//   - far: a fixed layer of soft distant lights, moved at 0.2x the scroll by a GPU transform
//     (no repaint); still in Firefox and with reduced motion.
// The text colours are chosen so every text keeps 4.5:1 over any street pixel, so the street may
// sit behind text. Cards, menus and controls paint over it like over any background.
//
// Performance: no layout reading except the page's height and width, no measuring of elements,
// no animations, no filters. The drawing changes only when the window width changes or the page
// grows (rows are added). <html data-fanous-street="off"> (watch and Shorts pages) switches the
// street off at once.

const NS = 'http://www.w3.org/2000/svg';
const ID = 'fanous-street';
const LIGHTS_ID = 'fanous-street-lights';
// The lantern, drawn after the theme's lantern art: ring and finial, onion dome, collar,
// hexagonal body with three arched windows (class fs-w, lit by --fanous-street-window), base, drop.
const LANTERN = '<circle cx="0" cy="4" r="3"/><path d="M0 7V12"/><path d="M-14 34C-18 24-6 20 0 12C6 20 18 24 14 34Z"/><path d="M-17 34H17V38H-17Z"/><path d="M-15 38H15L18 44V74L15 80H-15L-18 74V44Z"/><path class="fs-w" d="M-5 74V55C-5 50-1 49 0 45C1 49 5 50 5 55V74Z"/><path class="fs-w" d="M-14 73V58C-14 55-12 54-11 51C-10 54-9 55-9 58V73Z"/><path class="fs-w" d="M14 73V58C14 55 12 54 11 51C10 54 9 55 9 58V73Z"/><path d="M-17 80H17L12 88H-12Z"/><path d="M-4 88L0 96L4 88"/>';

/** Whether the active theme and mode switch the street on (and the page allows it). */
export function streetEnabled(doc = globalThis.document) {
  if (doc.documentElement.dataset.fanousStreet === 'off') return false;
  return doc.defaultView.getComputedStyle(doc.documentElement).getPropertyValue('--fanous-street-on').trim() === '1';
}

/** A small seeded random number generator (mulberry32): the same seed, the same numbers. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The scale of the scene for a window width: phones get narrower building edges and closer rows. */
export function sceneScale(width) {
  const phone = width < 640;
  return { phone, edge: phone ? 10 : 22, pitch: phone ? [150, 190] : [175, 235], first: phone ? 36 : 56, maxH: phone ? 38 : 46 };
}

const tops = new Map();
/** The top of row k (page coordinates): row spacing varies, but never depends on the page height. */
export function rowTop(k, width) {
  const s = sceneScale(width);
  const list = tops.get(s.phone) || [s.first];
  tops.set(s.phone, list);
  while (list.length <= k) {
    const i = list.length - 1;
    const r = seeded(Math.imul(i + 1, 40503) ^ 0x9e3779b9)();
    list.push(list[i] + s.pitch[0] + (s.pitch[1] - s.pitch[0]) * r);
  }
  return list[k];
}

/**
 * Row k of the street for a window width: one string from the left bracket to the right one
 * through its hang points (every swag starts where the last one ended), and its lanterns.
 */
export function streetRow(k, width) {
  const s = sceneScale(width);
  const rnd = seeded(Math.imul(k + 1, 2654435761) ^ (s.phone ? 0x5bd1e995 : 0x1b873593));
  const r = (lo, hi) => lo + (hi - lo) * rnd();
  const top = rowTop(k, width);
  const xa = s.edge + 6, xb = width - s.edge - 6;
  // Hang points: evenly spread with some play, so the swags differ in length row to row
  const n = Math.max(1, Math.round((xb - xa) / r(s.phone ? 170 : 260, s.phone ? 260 : 420)));
  const points = [{ x: xa, y: top + r(-4, 4) }];
  for (let i = 1; i < n; i++) points.push({ x: xa + ((xb - xa) * (i + r(-0.18, 0.18))) / n, y: top + r(-6, 6) });
  points.push({ x: xb, y: top + r(-4, 4) });
  const swags = [];
  const lanterns = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = b.x - a.x;
    const sag = r(s.phone ? 8 : 10, s.phone ? 18 : 26);
    swags.push({ xa: a.x, ya: a.y, xb: b.x, yb: b.y, sag });
    const count = Math.max(1, Math.min(3, Math.round(len / r(110, 170))));
    const ts = [];
    for (let j = 0; j < count * 3 && ts.length < count; j++) {
      const t = r(0.14, 0.86);
      if (ts.every((u) => Math.abs(u - t) * len > 46)) ts.push(t);
    }
    for (const t of ts) {
      const lx = a.x + t * len;
      const ly = a.y + (b.y - a.y) * t + sag * 4 * t * (1 - t);
      const h = r(s.maxH * 0.55, s.maxH);
      const half = (24 * h) / 100;
      if (lx - half < s.edge + 4 || lx + half > width - s.edge - 4) continue;
      lanterns.push({ x: lx, top: ly, y: ly + r(6, s.phone ? 24 : 30), h });
    }
  }
  return { top, swags, lanterns };
}

const f = (n) => n.toFixed(1);

/** The drawing of rows [from, to) for a window width, as SVG markup. */
function rowsMarkup(from, to, width) {
  let out = '';
  for (let k = from; k < to; k++) {
    const { swags, lanterns } = streetRow(k, width);
    let d = `M${f(swags[0].xa)} ${f(swags[0].ya)}`;
    for (const sw of swags) d += `Q${f((sw.xa + sw.xb) / 2)} ${f((sw.ya + sw.yb) / 2 + sw.sag * 2)} ${f(sw.xb)} ${f(sw.yb)}`;
    let lamps = '';
    for (const l of lanterns) {
      const sc = l.h / 100;
      // The lit lantern's warm glow (a static gradient fill, no filter), then its cord and the lantern
      lamps += `<circle class="fs-glow" cx="${f(l.x)}" cy="${f(l.y + 62 * sc)}" r="${f(30 * sc)}" fill="url(#fs-g)" stroke="none"/>`
        + `<path d="M${f(l.x)} ${f(l.top)}V${f(l.y)}"/><use class="fs-l" href="#fs-lantern" x="${f(l.x - 24 * sc)}" y="${f(l.y)}" width="${f(48 * sc)}" height="${f(100 * sc)}"/>`;
    }
    out += `<g class="fs-row" data-row="${k}"><path d="${d}"/>${lamps}</g>`;
  }
  return out;
}

/** The building edges down both sides, with a bracket at each row's ends, for rows [from, to). */
function edgesMarkup(from, to, width) {
  const s = sceneScale(width);
  let out = '';
  for (let k = from; k < to; k++) {
    const { swags } = streetRow(k, width);
    const yl = swags[0].ya, yr = swags[swags.length - 1].yb;
    const y0 = k === 0 ? 0 : rowTop(k, width) - 12;
    const y1 = rowTop(k + 1, width) - 12;
    // Wall lines for this stretch (they meet the next stretch's), a bracket and ring at the string's ends
    out += `<path d="M${s.edge} ${f(y0)}V${f(y1)}M${width - s.edge} ${f(y0)}V${f(y1)}"/>`;
    out += `<path d="M0 ${f(yl - 3)}H${s.edge + 4}M${width} ${f(yr - 3)}H${width - s.edge - 4}"/>`;
    out += `<circle cx="${s.edge + 6}" cy="${f(yl)}" r="2.4"/><circle cx="${width - s.edge - 6}" cy="${f(yr)}" r="2.4"/>`;
    // A lit arched window in the wall between brackets, now and then (each side its own)
    const rnd = seeded(Math.imul(k + 7, 97531));
    const ww = s.edge - 8;
    if (ww >= 6) {
      for (const side of [0, 1]) {
        if (rnd() < 0.55) continue;
        const wy = yl + 30 + rnd() * Math.max(10, y1 - yl - 80);
        const wx = side ? width - s.edge + 4 : 4;
        out += `<path class="fs-w" d="M${f(wx)} ${f(wy + 26)}V${f(wy + 8)}Q${f(wx + ww / 2)} ${f(wy - 2)} ${f(wx + ww)} ${f(wy + 8)}V${f(wy + 26)}Z"/>`;
      }
    }
  }
  return out;
}

/**
 * Draws (or extends) the street for the current page size. Cheap to call: it redraws only when
 * the width changed and otherwise only adds the rows the page grew by. Returns what it drew.
 */
export function renderStreet(doc = globalThis.document) {
  const win = doc.defaultView;
  if (!streetEnabled(doc)) { doc.getElementById(ID)?.remove(); return { placed: 0, reason: 'off' }; }
  const width = doc.documentElement.clientWidth || win.innerWidth;
  const height = Math.max(doc.body.offsetHeight, win.innerHeight);
  let svg = doc.getElementById(ID);
  if (!svg) {
    svg = doc.createElementNS(NS, 'svg');
    svg.id = ID;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    doc.body.prepend(svg);
  }
  const state = svg.__street || (svg.__street = {});
  if (state.width !== width) {
    svg.innerHTML = '<defs><radialGradient id="fs-g"><stop offset="0" class="fs-g0"/><stop offset="1" class="fs-g1"/></radialGradient>'
      + `<symbol id="fs-lantern" viewBox="-24 0 48 100" overflow="visible">${LANTERN}</symbol></defs>`
      + `<g class="fs-lines" stroke-width="${width < 640 ? 1.3 : 1.5}"><g class="fs-edges"></g><g class="fs-rows"></g></g>`;
    state.width = width;
    state.rows = 0;
  }
  let rows = state.rows;
  while (rowTop(rows, width) < height + 40) rows++;
  if (rows > state.rows) {
    svg.querySelector('.fs-edges').insertAdjacentHTML('beforeend', edgesMarkup(state.rows, rows, width));
    svg.querySelector('.fs-rows').insertAdjacentHTML('beforeend', rowsMarkup(state.rows, rows, width));
    state.rows = rows;
  }
  return { placed: svg.querySelectorAll('.fs-l').length, rows: state.rows };
}

/**
 * Starts the street on this page and keeps it in step with the page size, theme and mode.
 * Safe to call more than once; returns a function that stops it and removes the drawing.
 */
export function startStreet(doc = globalThis.document) {
  const win = doc.defaultView;
  if (win.__fanousStreetStop) return win.__fanousStreetStop;
  const html = doc.documentElement;
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  const dark = win.matchMedia('(prefers-color-scheme: dark)');
  // Firefox repaints large fixed layers expensively: there the distant lights stand still
  const still = /firefox/i.test(win.navigator.userAgent);
  let frame = 0, timer = 0;
  const lights = () => doc.getElementById(LIGHTS_ID);
  // Far: the soft distant lights drift at 0.2x the scroll, moved within one 260px tile by a transform
  const drift = () => {
    frame = 0;
    const el = lights();
    if (!el) return;
    const y = reduce.matches || still ? 0 : -((0.2 * win.scrollY) % 260);
    el.style.transform = y ? `translate3d(0, ${y.toFixed(1)}px, 0)` : '';
  };
  const onScroll = () => { if (!frame && !still && !reduce.matches) frame = win.requestAnimationFrame(drift); };
  const sync = () => {
    const on = streetEnabled(doc);
    html.classList.toggle('fanous-street', on);
    if (!on) {
      doc.getElementById(ID)?.remove();
      lights()?.remove();
      return;
    }
    if (!lights()) {
      const el = doc.createElement('div');
      el.id = LIGHTS_ID;
      el.setAttribute('aria-hidden', 'true');
      doc.body.prepend(el);
    }
    drift();
    renderStreet(doc);
  };
  // The page size: a quiet half second after it changes, extend or redraw (no element measuring)
  const soon = () => { win.clearTimeout(timer); timer = win.setTimeout(sync, 500); };
  const ro = new win.ResizeObserver(soon);
  ro.observe(doc.body);
  // A theme, mode or page switch takes effect at once
  const htmlObs = new win.MutationObserver(sync);
  htmlObs.observe(html, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode', 'data-fanous-street'] });
  dark.addEventListener?.('change', sync);
  reduce.addEventListener?.('change', drift);
  win.addEventListener('scroll', onScroll, { passive: true });
  sync();
  const stop = () => {
    ro.disconnect();
    htmlObs.disconnect();
    dark.removeEventListener?.('change', sync);
    reduce.removeEventListener?.('change', drift);
    win.removeEventListener('scroll', onScroll);
    if (frame) win.cancelAnimationFrame(frame);
    win.clearTimeout(timer);
    doc.getElementById(ID)?.remove();
    lights()?.remove();
    html.classList.remove('fanous-street');
    delete win.__fanousStreetStop;
  };
  win.__fanousStreetStop = stop;
  return stop;
}
