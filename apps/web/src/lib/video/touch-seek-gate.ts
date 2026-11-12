/**
 * Touch on the progress bar: a tap seeks, a sideways drag scrubs, an up or down drag scrolls the page.
 *
 * Video.js seeks (and pauses) on the progress bar's touchstart, and the bar's 44px touch target has
 * `touch-action: none`. On a phone with the player half scrolled off, the bar and its target are
 * most of what shows, so a finger put down to scroll the page paused the video and jumped it to
 * wherever the finger landed. The bar now waits to see what the finger does: it takes the touch
 * only once it is a tap or a sideways move, and hands the same touch to Video.js's own handler,
 * which then scrubs and releases as before. The skin gives the bar `touch-action: pan-y` so the
 * browser scrolls on an up or down drag (player-skin.css).
 */

/** How far (px) a finger may shake and still be tapping */
const SLOP = 8;

interface ProgressControlLike {
  el(): Element;
  handleMouseDown(event: unknown): void;
}

export interface TouchSeekPlayerLike {
  getChild(name: string): { getChild(name: string): unknown } | undefined;
  userActive(active: boolean): void;
}

/** A touchstart-shaped event at this touch, for Video.js's pointer maths (lib getPointerPosition) */
function startEventAt(touch: Touch, target: EventTarget | null) {
  const point = { clientX: touch.clientX, clientY: touch.clientY, pageX: touch.pageX, pageY: touch.pageY };
  return {
    type: 'touchstart',
    target,
    touches: [point],
    changedTouches: [point],
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  };
}

export function setupTouchSeekGate(player: TouchSeekPlayerLike): () => void {
  const control = player.getChild('ControlBar')?.getChild('ProgressControl') as ProgressControlLike | undefined;
  const el = control?.el();
  if (!control || !el) return () => undefined;

  let pending: { x: number; y: number; target: EventTarget | null } | null = null;

  const take = (touch: Touch, target: EventTarget | null) => {
    pending = null;
    // Video.js's handler adds its document move and end listeners; the current event bubbles on to them
    control.handleMouseDown(startEventAt(touch, target));
  };

  // Capture: runs before Video.js's own touchstart handlers on the bar and its children
  const onStart = (event: Event) => {
    const e = event as TouchEvent;
    if (e.touches.length !== 1) {
      pending = null;
      return;
    }
    e.stopImmediatePropagation();
    player.userActive(true);
    pending = { x: e.touches[0].clientX, y: e.touches[0].clientY, target: e.target };
  };
  const onMove = (event: Event) => {
    if (!pending) return;
    const touch = (event as TouchEvent).touches[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - pending.x);
    const dy = Math.abs(touch.clientY - pending.y);
    if (dx < SLOP && dy < SLOP) return;
    if (dx > dy) take(touch, pending.target);
    else pending = null; // the browser scrolls the page
  };
  const onEnd = (event: Event) => {
    if (!pending) return;
    const touch = (event as TouchEvent).changedTouches[0];
    if (touch) take(touch, pending.target);
  };
  const onCancel = () => {
    pending = null;
  };

  el.addEventListener('touchstart', onStart, { capture: true, passive: true });
  el.addEventListener('touchmove', onMove, { passive: true });
  el.addEventListener('touchend', onEnd, { passive: true });
  el.addEventListener('touchcancel', onCancel, { passive: true });
  return () => {
    el.removeEventListener('touchstart', onStart, { capture: true });
    el.removeEventListener('touchmove', onMove);
    el.removeEventListener('touchend', onEnd);
    el.removeEventListener('touchcancel', onCancel);
  };
}
