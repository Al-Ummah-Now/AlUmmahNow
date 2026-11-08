/**
 * Event listener scoping helpers (Story 1.2, AC 4).
 *
 * The video player needs a document-level keydown listener so shortcuts keep
 * working when focus is on the page body or the player is fullscreen. Without
 * scoping, such a listener would also react to keys typed into other widgets
 * (dialogs, menus, other players) and would double-handle events that already
 * reached the player element's own listener.
 */

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const ISOLATED_WIDGET_SELECTOR = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [role="combobox"]';
const PLAYER_SELECTOR = '.video-js';

export interface GlobalShortcutScopeOptions {
  /**
   * Set when the document listener is the only listener (no element-level
   * listener on the player), so events from inside the player are handled too.
   */
  handleEventsInsidePlayer?: boolean;
}

function asElement(target: EventTarget | null): Element | null {
  if (!target || typeof Element === 'undefined') return null;
  if (target instanceof Element) return target;
  if (typeof Node !== 'undefined' && target instanceof Node) return target.parentElement;
  return null;
}

/**
 * Decide whether a document-level keyboard event belongs to the given player.
 */
export function shouldHandleGlobalPlayerShortcut(
  event: Event,
  playerElement: Element,
  options: GlobalShortcutScopeOptions = {},
): boolean {
  if (!event.isTrusted) return false;
  const target = asElement(event.target);

  // Fullscreen player owns the keyboard.
  const fullscreen = typeof document !== 'undefined' ? document.fullscreenElement : null;
  if (fullscreen) {
    if (!(fullscreen === playerElement || fullscreen.contains(playerElement) || playerElement.contains(fullscreen))) {
      return false;
    }
  }

  if (!target || target === document.body || target === document.documentElement) return true;

  if (target.closest(EDITABLE_SELECTOR)) return false;
  if (playerElement.contains(target)) return options.handleEventsInsidePlayer === true;
  if (target.closest(ISOLATED_WIDGET_SELECTOR)) return false;

  const otherPlayer = target.closest(PLAYER_SELECTOR);
  if (otherPlayer && otherPlayer !== playerElement) return false;

  return true;
}

/**
 * Register a listener that is removed automatically when `signal` aborts (e.g.
 * on component unmount or player dispose). Returns the cleanup function.
 */
export function addScopedListener<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  signal?: AbortSignal,
): () => void;
export function addScopedListener(
  target: EventTarget,
  type: string,
  handler: (event: Event) => void,
  signal?: AbortSignal,
): () => void;
export function addScopedListener(
  target: EventTarget,
  type: string,
  handler: (event: Event) => void,
  signal?: AbortSignal,
): () => void {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  target.addEventListener(type, handler, { signal: controller.signal });
  return () => {
    signal?.removeEventListener('abort', abort);
    controller.abort();
  };
}
