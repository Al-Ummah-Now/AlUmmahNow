// Fanous lantern street: the shared module every Al Ummah Now app includes (videos, admin, www,
// CMS, sign-in, profile, accounts admin). Plain JavaScript, no dependencies, so other repos can
// vendor this file as is (with fanous-street.css).
//
// The theme decides: the active theme's tokens set --fanous-street-on to 1 (theme package
// `street` section, Fawanees). This module then marks <html class="fanous-street"> and paints the
// street as the page background, behind every element:
//   - far: a fixed layer of soft distant lights that drifts at 0.2x the scroll, and
//   - near: strings of whole lanterns, row after row down the whole page, moving with the page.
//     Every row is drawn from its own seeded random numbers (swag lengths, sag, lantern spacing,
//     drop lengths, sizes), so rows never repeat or line up, and the same page always draws the
//     same street (reloads and screenshots match). Rows are laid out on a wide virtual strip, so
//     resizing the window keeps them where they were.
// Cards, menus and controls paint over it as they would over any background. The theme's street
// colours are chosen so every text colour keeps 4.5:1 over the brightest or darkest street pixel.
// Reduced motion: the far lights stand still (the near street simply scrolls with the page).
// No CSS animations, so nothing waits forever on document.getAnimations().

const NS = 'http://www.w3.org/2000/svg';
const ID = 'fanous-street';
const LIGHTS_ID = 'fanous-street-lights';
// The lantern, drawn after the theme's lantern art: ring and finial, onion dome, collar,
// hexagonal body with three arched windows (class fs-w, lit by --fanous-street-window), base, drop.
const LANTERN = '<circle cx="0" cy="4" r="3"/><path d="M0 7V12"/><path d="M-14 34C-18 24-6 20 0 12C6 20 18 24 14 34Z"/><path d="M-17 34H17V38H-17Z"/><path d="M-15 38H15L18 44V74L15 80H-15L-18 74V44Z"/><path class="fs-w" d="M-5 74V55C-5 50-1 49 0 45C1 49 5 50 5 55V74Z"/><path class="fs-w" d="M-14 73V58C-14 55-12 54-11 51C-10 54-9 55-9 58V73Z"/><path class="fs-w" d="M14 73V58C14 55 12 54 11 51C10 54 9 55 9 58V73Z"/><path d="M-17 80H17L12 88H-12Z"/><path d="M-4 88L0 96L4 88"/>';
/** The virtual strip each row is laid out on (wider than any screen). */
const STRIP = 4096;

/** Whether the active theme and mode switch the street on. */
export function streetEnabled(doc = globalThis.document) {
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

/** The row pitch: phones get closer rows (smaller screens). */
export function rowHeight(width) {
  return width < 640 ? 150 : 180;
}

/**
 * One row of the street, laid out on the virtual strip: its strings (swags between posts) and its
 * lanterns. Depends only on the row number and the phone/desktop scale, never on the window width.
 */
export function streetRow(k, phone) {
  const rnd = seeded(Math.imul(k + 1, 2654435761) ^ (phone ? 0x5bd1e995 : 0x1b873593));
  const r = (lo, hi) => lo + (hi - lo) * rnd();
  const maxH = phone ? 40 : 46;
  const y0 = r(4, 22);
  const swags = [];
  const lanterns = [];
  // One continuous string per row: each swag starts at the hang point where the last one ended
  let x = -r(0, 260);
  let ya = y0 + r(-6, 6);
  while (x < STRIP) {
    const len = r(phone ? 200 : 240, phone ? 340 : 440);
    const sag = r(8, 26);
    const yb = y0 + r(-6, 6);
    swags.push({ xa: x, ya, xb: x + len, yb, sag });
    // 1 to 3 lanterns along this swag, never closer than a lantern's width to each other
    const n = 1 + Math.floor(rnd() * 3);
    const ts = [];
    for (let i = 0; i < n; i++) {
      const t = r(0.12, 0.88);
      if (ts.every((u) => Math.abs(u - t) * len > 44)) ts.push(t);
    }
    for (const t of ts) {
      const lx = x + t * len;
      const ly = ya + (yb - ya) * t + sag * 4 * t * (1 - t);
      const h = r(maxH * 0.55, maxH);
      const cord = r(6, phone ? 26 : 34);
      lanterns.push({ x: lx, top: ly, y: ly + cord, h });
    }
    x += len;
    ya = yb;
  }
  return { swags, lanterns };
}

/** Draws the rows that cross the viewport at the current scroll (a fixed layer, page coordinates). */
function drawRows(svg, win, cache) {
  const w = win.innerWidth, h = win.innerHeight, phone = w < 640;
  const pitch = rowHeight(w);
  const sy = win.scrollY;
  const first = Math.floor((sy - 140) / pitch), last = Math.ceil((sy + h) / pitch);
  const key = `${w}|${first}|${last}`;
  const g = svg.firstElementChild.nextElementSibling;
  g.setAttribute('transform', `translate(0 ${-Math.round(sy)})`);
  if (cache.key === key) return;
  cache.key = key;
  let out = '';
  for (let k = Math.max(0, first); k <= last; k++) {
    const { swags, lanterns } = streetRow(k, phone);
    const top = k * pitch;
    let strings = '', bulbs = '', lamps = '';
    let d = '';
    for (const s of swags) {
      if (s.xb < -10 || s.xa > w + 10) continue;
      const mx = (s.xa + s.xb) / 2, my = (s.ya + s.yb) / 2 + s.sag * 2;
      if (!d) d = `M${s.xa.toFixed(1)} ${(top + s.ya).toFixed(1)}`;
      d += `Q${mx.toFixed(1)} ${(top + my).toFixed(1)} ${s.xb.toFixed(1)} ${(top + s.yb).toFixed(1)}`;
      for (let x = s.xa + 12; x < s.xb - 8; x += phone ? 18 : 22) {
        if (x < 2 || x > w - 2) continue;
        const t = (x - s.xa) / (s.xb - s.xa);
        bulbs += `<circle cx="${x.toFixed(1)}" cy="${(top + s.ya + (s.yb - s.ya) * t + s.sag * 4 * t * (1 - t) + 2.5).toFixed(1)}" r="1.6"/>`;
      }
    }
    if (d) strings = `<path d="${d}"/>`;
    for (const l of lanterns) {
      const sc = l.h / 100, half = 24 * sc;
      // Whole lanterns only: none cut by the window's side
      if (l.x - half < 2 || l.x + half > w - 2) continue;
      lamps += `<g class="fs-l"><circle cx="${l.x.toFixed(1)}" cy="${(top + l.y + 62 * sc).toFixed(1)}" r="${(30 * sc).toFixed(1)}" fill="url(#fs-g)" class="fs-glow" stroke="none"/>`
        + `<path d="M${l.x.toFixed(1)} ${(top + l.top).toFixed(1)}V${(top + l.y).toFixed(1)}"/>`
        + `<use href="#fs-lantern" x="${(l.x - half).toFixed(1)}" y="${(top + l.y).toFixed(1)}" width="${(48 * sc).toFixed(1)}" height="${(100 * sc).toFixed(1)}"/></g>`;
    }
    out += `<g class="fs-row" data-row="${k}">${bulbs}${strings}${lamps}</g>`;
  }
  g.innerHTML = out;
}

/**
 * Draws the street once for the current scroll (tests). Returns the rows and lanterns drawn, or
 * why it drew nothing.
 */
export function renderStreet(doc = globalThis.document) {
  const win = doc.defaultView;
  if (!streetEnabled(doc)) { doc.getElementById(ID)?.remove(); return { placed: 0, reason: 'off' }; }
  let svg = doc.getElementById(ID);
  if (!svg) {
    svg = doc.createElementNS(NS, 'svg');
    svg.id = ID;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = '<defs><radialGradient id="fs-g"><stop offset="0" class="fs-g0"/><stop offset="1" class="fs-g1"/></radialGradient>'
      + `<symbol id="fs-lantern" viewBox="-24 0 48 100" overflow="visible">${LANTERN}</symbol></defs>`
      + '<g class="fs-lines"></g>';
    doc.body.prepend(svg);
    svg.__cache = {};
  }
  svg.querySelector('.fs-lines').setAttribute('stroke-width', win.innerWidth < 640 ? '1.3' : '1.5');
  drawRows(svg, win, svg.__cache);
  return { placed: svg.querySelectorAll('.fs-l').length, rows: svg.querySelectorAll('.fs-row').length };
}

/**
 * Starts the street on this page and keeps it in step with the scroll, size, theme and mode.
 * Safe to call more than once; returns a function that stops it and removes the drawing.
 */
export function startStreet(doc = globalThis.document) {
  const win = doc.defaultView;
  if (win.__fanousStreetStop) return win.__fanousStreetStop;
  const html = doc.documentElement;
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  const dark = win.matchMedia('(prefers-color-scheme: dark)');
  let frame = 0;
  const lights = () => doc.getElementById(LIGHTS_ID);
  // One frame per scroll: the near street follows the page, the far lights drift at 0.2x
  const step = () => {
    frame = 0;
    if (!html.classList.contains('fanous-street')) return;
    const el = lights();
    if (el) el.style.backgroundPosition = `0 ${reduce.matches ? 0 : Math.round(-0.2 * win.scrollY)}px`;
    renderStreet(doc);
  };
  const onScroll = () => { if (!frame) frame = win.requestAnimationFrame(step); };
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
    step();
  };
  // A theme or mode change switches the street on or off at once
  const htmlObs = new win.MutationObserver(sync);
  htmlObs.observe(html, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode'] });
  dark.addEventListener?.('change', sync);
  reduce.addEventListener?.('change', step);
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onScroll, { passive: true });
  sync();
  const stop = () => {
    htmlObs.disconnect();
    dark.removeEventListener?.('change', sync);
    reduce.removeEventListener?.('change', step);
    win.removeEventListener('scroll', onScroll);
    win.removeEventListener('resize', onScroll);
    if (frame) win.cancelAnimationFrame(frame);
    doc.getElementById(ID)?.remove();
    lights()?.remove();
    html.classList.remove('fanous-street');
    delete win.__fanousStreetStop;
  };
  win.__fanousStreetStop = stop;
  return stop;
}
