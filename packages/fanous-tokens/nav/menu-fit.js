/**
 * Keeps an open popup inside the viewport (docs/design/NAV.md "Menus never leave the screen"; owner
 * bug 2026-11-13: a header menu opened off-screen on a phone). Framework-free; the videos web and
 * admin import it, www, the CMS and Auth carry the same function in their own scripts.
 *
 * Call after the popup is shown (and again when its content changes size). It:
 *  - shifts the popup sideways (CSS `translate`) so both edges keep an 8px gutter, and narrows it
 *    when it is wider than the screen;
 *  - keeps it below its anchor when it fits there; otherwise, when there is more room above the
 *    anchor (the popup's offsetParent) than below, opens it upwards; either way caps its height to
 *    the room on that side (the popup scrolls inside, so give it overflow-y: auto). Never a minimum
 *    height: a floor is what pushed a picker past a landscape phone's bottom (WebKit, 844×390);
 *  - measures against the visual viewport where there is one (an on-screen keyboard shrinks it).
 * While a popup is fitted it is re-fitted when its own size changes (results arriving after it opened:
 * measuring only at open let a picker grow past the edge) and on resize or orientation change.
 * Popups placed by a positioning library (Radix collision handling) do not need it.
 */
const GUTTER = 8;
const fitted = new Set();
const observers = new Map();
let listening = false;

function stopObserving(el) {
  observers.get(el)?.disconnect();
  observers.delete(el);
}

/** Re-fit when the popup's size changes; the last size guards against reacting to our own cap. */
function observe(el) {
  if (observers.has(el) || typeof ResizeObserver === 'undefined') return;
  let last = '';
  const ro = new ResizeObserver(() => {
    const r = el.getBoundingClientRect();
    const size = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (size === last) return;
    last = size;
    fitToViewport(el);
  });
  ro.observe(el);
  observers.set(el, ro);
}

/** The visible area in layout-viewport coordinates (getBoundingClientRect's). */
function viewport() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  if (!vv) return { left: 0, top: 0, right: width, bottom: height };
  return {
    left: Math.max(0, vv.offsetLeft),
    top: Math.max(0, vv.offsetTop),
    right: Math.min(width, vv.offsetLeft + vv.width),
    bottom: Math.min(height, vv.offsetTop + vv.height),
  };
}

/** @param {HTMLElement | null | undefined} el */
export function fitToViewport(el) {
  if (!el) return;
  el.style.removeProperty('translate');
  el.style.removeProperty('max-inline-size');
  el.style.removeProperty('max-block-size');
  if (el.hidden || !el.isConnected || el.getClientRects().length === 0) {
    fitted.delete(el);
    stopObserving(el);
    return;
  }
  fitted.add(el);
  observe(el);
  if (!listening) {
    listening = true;
    const refit = () => fitted.forEach((f) => fitToViewport(f));
    window.addEventListener('resize', refit);
    window.visualViewport?.addEventListener('resize', refit);
  }
  const vp = viewport();
  let r = el.getBoundingClientRect();
  if (r.width > vp.right - vp.left - 2 * GUTTER) {
    el.style.maxInlineSize = `${vp.right - vp.left - 2 * GUTTER}px`;
    r = el.getBoundingClientRect();
  }
  const dx = r.left < vp.left + GUTTER ? vp.left + GUTTER - r.left : r.right > vp.right - GUTTER ? vp.right - GUTTER - r.right : 0;

  let dy = 0;
  const below = Math.floor(vp.bottom - GUTTER - Math.max(r.top, vp.top + GUTTER));
  let cap = r.height > below ? below : null;
  if (cap !== null) {
    // Not enough room below: open upwards when the anchor (the positioned box it hangs from) has
    // more room above it. A fixed popup (a phone sheet) has no anchor to flip around.
    const anchor = getComputedStyle(el).position === 'fixed' ? null : el.offsetParent;
    if (anchor && anchor !== document.body && anchor !== document.documentElement) {
      const a = anchor.getBoundingClientRect();
      const gap = Math.max(0, r.top - a.bottom);
      const above = Math.floor(a.top - gap - (vp.top + GUTTER));
      if (above > below) {
        const height = Math.min(r.height, above);
        cap = r.height > above ? above : null;
        dy = a.top - gap - height - r.top;
      }
    }
  }
  if (cap !== null) el.style.maxBlockSize = `${Math.max(cap, 0)}px`;
  if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
}

/** Stop re-fitting a popup that closed (optional: hidden or detached popups are dropped on resize). */
export function releaseFit(el) {
  if (!el) return;
  fitted.delete(el);
  stopObserving(el);
}
