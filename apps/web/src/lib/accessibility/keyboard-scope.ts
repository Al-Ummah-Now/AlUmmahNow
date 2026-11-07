/**
 * Keyboard shortcut scoping (Story 1.4 - consistent, predictable keyboard use)
 *
 * Decides whether a keydown should be treated as a video player shortcut.
 * Rules (WCAG 2.1.1 / 2.1.4 / 2.4.3):
 * - Never steal keys from editable fields (input, textarea, select, contenteditable)
 * - Never steal browser / OS shortcuts (Ctrl, Meta or Alt held)
 * - Outside the player, only handle keys when nothing in particular has focus
 *   (focus on <body>), so Space/arrow keys on links, buttons and scrollable
 *   page content keep their native behaviour
 * - Inside the player, let focused controls keep their native keys:
 *   Space/Enter activate buttons and menu items, arrow/Home/End/Page keys
 *   operate sliders (seek bar, volume) and menus
 */

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const ACTIVATION_KEYS = new Set([' ', 'Enter', 'Spacebar']);
const NAVIGATION_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
]);
const BUTTON_LIKE_ROLES = new Set(['button', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'link', 'switch', 'checkbox', 'tab', 'option']);
const ARROW_WIDGET_ROLES = new Set(['slider', 'menu', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'listbox', 'option', 'radiogroup', 'tablist', 'tab', 'spinbutton']);

export function isEditableElement(element: Element | null): boolean {
  if (!element) return false;
  if (EDITABLE_TAGS.has(element.tagName)) return true;
  if ((element as HTMLElement).isContentEditable) return true;
  return element.getAttribute('contenteditable') === 'true';
}

function isButtonLike(element: Element): boolean {
  const tag = element.tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true;
  const role = element.getAttribute('role');
  return !!role && BUTTON_LIKE_ROLES.has(role);
}

function isArrowWidget(element: Element): boolean {
  const role = element.getAttribute('role');
  return !!role && ARROW_WIDGET_ROLES.has(role);
}

export interface ShortcutKeyEvent {
  key: string;
  target: EventTarget | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * @param event - the keydown event
 * @param playerElement - Video.js root element
 * @param activeElement - document.activeElement (injectable for tests)
 */
export function shouldHandlePlayerShortcut(
  event: ShortcutKeyEvent,
  playerElement: Element,
  activeElement: Element | null = typeof document !== 'undefined' ? document.activeElement : null,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;

  const target = (event.target instanceof Element ? event.target : null) ?? activeElement;
  if (isEditableElement(target) || isEditableElement(activeElement)) return false;

  const focused = target ?? activeElement;
  const ownerDocument = playerElement.ownerDocument;
  const nothingFocused =
    !focused || focused === ownerDocument.body || focused === ownerDocument.documentElement;

  if (!focused || !playerElement.contains(focused)) {
    return nothingFocused;
  }

  if (focused === playerElement) return true;

  if (ACTIVATION_KEYS.has(event.key) && isButtonLike(focused)) return false;
  if (NAVIGATION_KEYS.has(event.key) && isArrowWidget(focused)) return false;

  return true;
}
