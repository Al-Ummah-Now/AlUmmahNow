/**
 * Touch feedback for video player controls (Story 1.5, AC 3 and AC 5)
 *
 * - Adds `vjs-touch-active` to the touched control for a visible pressed state
 *   (CSS :active is unreliable on iOS Safari without a touch listener)
 * - Short haptic pulse via the Vibration API where supported, skipped when the
 *   user prefers reduced motion
 * - Passive listeners only, so scrolling and video playback are never blocked
 */

export const TOUCH_ACTIVE_CLASS = 'vjs-touch-active';
export const MIN_FEEDBACK_MS = 120;
export const HAPTIC_PULSE_MS = 10;

const CONTROL_SELECTOR = [
  'button',
  '[role="button"]',
  '[role="slider"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '.vjs-control',
].join(',');

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Trigger a short haptic pulse when the device supports it. Returns true if requested. */
export function hapticPulse(durationMs: number = HAPTIC_PULSE_MS): boolean {
  if (prefersReducedMotion()) return false;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (!nav || typeof nav.vibrate !== 'function') return false;
  try {
    return nav.vibrate(durationMs);
  } catch {
    return false;
  }
}

/**
 * Attach touch feedback to every control inside `root`.
 * @returns cleanup function
 */
export function setupTouchFeedback(root: HTMLElement | null | undefined): () => void {
  if (!root) return () => {};

  let activeControl: HTMLElement | null = null;
  let pressedAt = 0;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;

  const release = () => {
    const control = activeControl;
    if (!control) return;
    const remaining = Math.max(0, MIN_FEEDBACK_MS - (Date.now() - pressedAt));
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      control.classList.remove(TOUCH_ACTIVE_CLASS);
      releaseTimer = null;
    }, remaining);
    activeControl = null;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest<HTMLElement>(CONTROL_SELECTOR);
    if (!control || !root.contains(control)) return;
    if (control.matches(':disabled, [aria-disabled="true"]')) return;

    if (activeControl && activeControl !== control) {
      activeControl.classList.remove(TOUCH_ACTIVE_CLASS);
    }
    activeControl = control;
    pressedAt = Date.now();
    control.classList.add(TOUCH_ACTIVE_CLASS);
    hapticPulse();
  };

  root.addEventListener('pointerdown', handlePointerDown, { passive: true });
  root.addEventListener('pointerup', release, { passive: true });
  root.addEventListener('pointercancel', release, { passive: true });
  root.addEventListener('pointerleave', release, { passive: true });

  return () => {
    root.removeEventListener('pointerdown', handlePointerDown);
    root.removeEventListener('pointerup', release);
    root.removeEventListener('pointercancel', release);
    root.removeEventListener('pointerleave', release);
    if (releaseTimer) clearTimeout(releaseTimer);
    activeControl?.classList.remove(TOUCH_ACTIVE_CLASS);
    activeControl = null;
  };
}
