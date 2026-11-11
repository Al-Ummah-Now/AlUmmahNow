/**
 * The admin lists' keyboard model: j / k move between rows, x selects the
 * current row, Enter opens it, / focuses the search box and u undoes the last
 * change. Never while the admin types in a field or with a modifier held (the
 * browser's and the screen reader's own shortcuts win). Pure, so the unit tests
 * check it key by key.
 */

export type ListKeyAction = 'next' | 'prev' | 'toggle' | 'open' | 'search' | 'undo';

export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** An IME is composing: the key belongs to it. */
  isComposing?: boolean;
}

/** What a focused element looks like to the model (an Element in the browser). */
export interface TargetInput {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
  role?: string | null;
}

const TYPING_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton', 'listbox', 'slider']);
/** Inputs where a letter key is a value, not a shortcut (a checkbox or a button is not one of them). */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color']);

/** True when the key goes into a field: a text input, textarea, select, editable content or an ARIA text role. */
export function isTypingTarget(target: TargetInput | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((target.type ?? 'text').toLowerCase());
  return !!target.role && TYPING_ROLES.has(target.role);
}

/**
 * The list action for a key, or null when the key is not a list shortcut here.
 * `Enter` only opens when focus is on the list itself (on a link or button the
 * browser already does the right thing).
 */
export function listKeyAction(event: KeyInput, target: TargetInput | null | undefined, opts: { focusOnRowControl?: boolean } = {}): ListKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
  if (isTypingTarget(target)) return null;
  switch (event.key) {
    case 'j':
    case 'J':
      return 'next';
    case 'k':
    case 'K':
      return 'prev';
    case 'x':
    case 'X':
      return 'toggle';
    case '/':
      return 'search';
    case 'u':
    case 'U':
      return 'undo';
    case 'Enter':
      return opts.focusOnRowControl ? null : 'open';
    default:
      return null;
  }
}

/**
 * The next current row. From "none" (-1), j goes to the first row and k to the
 * last; the ends do not wrap (a long list should not jump back to the top).
 */
export function moveIndex(current: number, count: number, direction: 'next' | 'prev'): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return direction === 'next' ? 0 : count - 1;
  return direction === 'next' ? Math.min(current + 1, count - 1) : Math.max(current - 1, 0);
}
