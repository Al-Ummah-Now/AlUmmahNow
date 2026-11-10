/**
 * The part of the viewport a popover may use: below the sticky site header and
 * above the phone tab bar (both fixed chrome that would cover it). Read from the
 * DOM each time, so it follows the header/tab bar as the theme and width change.
 */
export interface VisibleBand {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Gap kept between a popover and the band's edges. */
export const BAND_MARGIN = 8;

const shown = (el: Element | null): DOMRect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const s = getComputedStyle(el);
  return s.display === 'none' || s.visibility === 'hidden' ? null : r;
};

export function getVisibleBand(): VisibleBand {
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  let top = 0;
  let bottom = height;
  const header = shown(document.querySelector('.ah'));
  // Only while it sits at the top of the viewport (sticky); scrolled away it covers nothing
  if (header && header.top <= 0.5 && header.bottom > 0) top = Math.max(top, header.bottom);
  const tabbar = shown(document.querySelector('.tabbar'));
  if (tabbar && tabbar.top < bottom && tabbar.bottom >= height - 0.5) bottom = Math.min(bottom, tabbar.top);
  return { top, bottom, left: 0, right: width };
}

/**
 * Radix `collisionPadding` that keeps popper content inside the band. Safe on the
 * server (no padding); Radix content only renders open, so the DOM read is fresh.
 */
export function bandCollisionPadding(): { top: number; bottom: number; left: number; right: number } {
  if (typeof window === 'undefined') return { top: BAND_MARGIN, bottom: BAND_MARGIN, left: BAND_MARGIN, right: BAND_MARGIN };
  const band = getVisibleBand();
  const height = window.visualViewport?.height ?? window.innerHeight;
  return {
    top: band.top + BAND_MARGIN,
    bottom: height - band.bottom + BAND_MARGIN,
    left: BAND_MARGIN,
    right: BAND_MARGIN,
  };
}

export interface PlacedBox {
  top: number;
  left: number;
  maxHeight: number;
  side: 'top' | 'bottom';
}

/**
 * Places a menu of `size` next to `anchor`: below it when it fits in the band,
 * else above it when that fits, else on the roomier side with a max height.
 * The inline end edge lines up with the anchor's end (right in LTR, left in RTL),
 * then shifts to stay inside the band horizontally.
 */
export function placeInBand(
  anchor: DOMRect,
  size: { width: number; height: number },
  band: VisibleBand,
  rtl: boolean,
  gap = 4,
): PlacedBox {
  const m = BAND_MARGIN;
  const below = band.bottom - m - (anchor.bottom + gap);
  const above = anchor.top - gap - (band.top + m);
  let side: 'top' | 'bottom';
  if (size.height <= below) side = 'bottom';
  else if (size.height <= above) side = 'top';
  else side = below >= above ? 'bottom' : 'top';
  const room = Math.max(0, side === 'bottom' ? below : above);
  const maxHeight = Math.max(Math.min(size.height, room), Math.min(size.height, band.bottom - band.top - 2 * m));
  let top = side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - Math.min(size.height, maxHeight);
  // Shift (not just flip) so the box is inside the band even when the anchor is half hidden
  top = Math.min(Math.max(top, band.top + m), band.bottom - m - Math.min(size.height, maxHeight));
  top = Math.max(top, band.top + m);
  let left = rtl ? anchor.left : anchor.right - size.width;
  left = Math.min(Math.max(left, band.left + m), band.right - m - size.width);
  left = Math.max(left, band.left + m);
  return { top, left, maxHeight, side };
}
