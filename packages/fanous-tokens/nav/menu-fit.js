/**
 * Keeps an open popup inside the viewport (docs/design/NAV.md "Menus never leave the screen"; owner
 * bug 2026-11-13: a header menu opened off-screen on a phone). Framework-free; the videos web and
 * admin import it, www and CMS carry the same function in their own scripts.
 *
 * Call after the popup is shown (and again when its content changes size): it shifts the popup
 * sideways with the CSS `translate` property so both edges keep an 8px gutter, narrows it when it is
 * wider than the screen, and caps its height to the room below its top (the popup scrolls inside,
 * so give it overflow-y: auto). While popups are fitted, a resize or orientation change re-fits them.
 * Popups placed by a positioning library (Radix collision handling) do not need it.
 */
const GUTTER = 8;
const fitted = new Set();
let listening = false;

/** @param {HTMLElement | null | undefined} el */
export function fitToViewport(el) {
  if (!el) return;
  el.style.removeProperty('translate');
  el.style.removeProperty('max-inline-size');
  el.style.removeProperty('max-block-size');
  if (el.hidden || !el.isConnected || el.getClientRects().length === 0) {
    fitted.delete(el);
    return;
  }
  fitted.add(el);
  if (!listening) {
    listening = true;
    window.addEventListener('resize', () => fitted.forEach((f) => fitToViewport(f)));
  }
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  let r = el.getBoundingClientRect();
  if (r.width > vw - 2 * GUTTER) {
    el.style.maxInlineSize = `${vw - 2 * GUTTER}px`;
    r = el.getBoundingClientRect();
  }
  const dx = r.left < GUTTER ? GUTTER - r.left : r.right > vw - GUTTER ? vw - GUTTER - r.right : 0;
  if (dx) el.style.translate = `${Math.round(dx)}px 0`;
  const room = Math.floor(vh - Math.max(r.top, 0) - GUTTER);
  const cssMax = parseFloat(getComputedStyle(el).maxBlockSize);
  if (!(cssMax <= room)) el.style.maxBlockSize = `${Math.max(room, 96)}px`;
}

/** Stop re-fitting a popup that closed (optional: hidden or detached popups are dropped on resize). */
export function releaseFit(el) {
  if (el) fitted.delete(el);
}
