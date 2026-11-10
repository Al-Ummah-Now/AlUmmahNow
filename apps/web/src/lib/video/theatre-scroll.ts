/**
 * Theatre on and off keeps the player in view (docs/specs/VIDEO-PLAYER.md section 5).
 *
 * Theatre changes the frame's size and moves the columns around it, but nothing scrolls the page,
 * so a frame whose top was already above the viewport stays there, now taller or shorter. That
 * happens when the viewer had scrolled down, and on every click in Firefox driven over WebDriver
 * BiDi: the pointer action scrolls the button (at the bottom of the frame) to the middle of the
 * viewport before it presses, which lifts the frame's top under the top bar or off screen.
 * After the layout changes, the page scrolls just enough to show the frame's top again.
 */

/** Space kept between the top bar (or the viewport edge) and the frame */
export const THEATRE_SCROLL_GAP = 16;

/** How much of the viewport's top the page's sticky or fixed top bar covers, in px */
export function stickyTopInset(doc: Document = document): number {
  const header = doc.querySelector('header');
  if (!header) return 0;
  const { position } = doc.defaultView?.getComputedStyle(header) ?? { position: '' };
  if (position !== 'sticky' && position !== 'fixed') return 0;
  return Math.max(0, header.getBoundingClientRect().bottom);
}

/**
 * The vertical scroll that shows the frame's top below the top bar, or 0 when it already shows.
 * A frame below the viewport is brought up the same way.
 */
export function theatreScrollDelta(frameTop: number, inset: number, viewportHeight: number, gap = THEATRE_SCROLL_GAP): number {
  if (frameTop >= inset && frameTop < viewportHeight) return 0;
  return Math.round(frameTop - inset - gap);
}

/** Scrolls the window so the frame's top is in view; call after the theatre layout is applied */
export function keepFrameInView(frame: HTMLElement | null): void {
  if (!frame || typeof window === 'undefined') return;
  const delta = theatreScrollDelta(frame.getBoundingClientRect().top, stickyTopInset(document), window.innerHeight);
  // 'instant': a page-wide `scroll-behavior: smooth` would animate it past the next layout change
  if (delta !== 0) window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
}
