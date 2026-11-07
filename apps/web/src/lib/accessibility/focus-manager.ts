/**
 * Focus management helpers (Story 1.4 - keyboard navigation).
 *
 * - getFocusableElements: tabbable descendants of a container, in DOM order
 * - trapFocus: keeps Tab / Shift+Tab inside a dialog and restores focus to the
 *   previously focused element when released
 * - focusElementById: moves focus to a landmark/target (used by skip links),
 *   making non-interactive targets programmatically focusable first
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',');

function isHidden(element: HTMLElement): boolean {
  if (element.hidden || element.closest('[inert]')) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return !!style && (style.display === 'none' || style.visibility === 'hidden');
}

/**
 * Tabbable descendants of `container` in DOM order. Elements with a negative
 * tabindex, disabled controls and hidden elements are excluded.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const tabIndex = element.getAttribute('tabindex');
    if (tabIndex !== null && Number(tabIndex) < 0) return false;
    return !isHidden(element);
  });
}

export interface FocusTrapOptions {
  /** Element focused when the trap activates (defaults to the first tabbable element) */
  initialFocus?: HTMLElement | null;
  /** Restore focus to the element that was focused before activation (default true) */
  restoreFocus?: boolean;
}

/**
 * Trap keyboard focus inside `container`. Returns a release function that
 * removes the trap and (by default) restores the previous focus.
 */
export function trapFocus(container: HTMLElement, options: FocusTrapOptions = {}): () => void {
  const { initialFocus, restoreFocus = true } = options;
  const doc = container.ownerDocument;
  const previouslyFocused = doc.activeElement as HTMLElement | null;

  const focusables = getFocusableElements(container);
  const target = initialFocus ?? focusables[0] ?? container;
  if (target === container && !container.hasAttribute('tabindex')) {
    container.setAttribute('tabindex', '-1');
  }
  target.focus();

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const elements = getFocusableElements(container);
    if (elements.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    const active = doc.activeElement as HTMLElement | null;
    const outside = !active || !container.contains(active);

    if (event.shiftKey && (active === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  }

  container.addEventListener('keydown', handleKeyDown);

  return () => {
    container.removeEventListener('keydown', handleKeyDown);
    if (restoreFocus && previouslyFocused && doc.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
  };
}

/**
 * Move focus to the element with `id` (or the first match of `fallbackSelector`).
 * Non-interactive targets get tabindex="-1" so they can receive focus without
 * entering the tab order. Returns true when focus moved.
 */
export function focusElementById(id: string, fallbackSelector?: string): boolean {
  const target =
    (document.getElementById(id) as HTMLElement | null) ??
    (fallbackSelector ? document.querySelector<HTMLElement>(fallbackSelector) : null);
  if (!target) return false;

  if (!target.matches(FOCUSABLE_SELECTOR)) {
    target.setAttribute('tabindex', '-1');
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
  return document.activeElement === target;
}
