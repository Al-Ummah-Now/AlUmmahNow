/**
 * The admin Select's pure rules (no DOM): the WAI-ARIA "select-only combobox" keyboard, typeahead,
 * and reading <option>/<optgroup> children into a flat option list. Kept apart from Select.tsx so
 * the keys are unit-tested without a browser (test/select.test.ts).
 */
import { Children, Fragment, isValidElement } from 'react';

export interface SelectOption {
  value: string;
  /** What the option shows (the <option>'s children). */
  label: React.ReactNode;
  /** Its plain text, for typeahead. */
  text: string;
  disabled?: boolean;
  /** The <optgroup> label it sits under, if any. */
  group?: string;
}

/** The plain text of a React node (strings and numbers, recursively). */
export function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

type OptionProps = { value?: string | number; disabled?: boolean; children?: React.ReactNode; label?: string };

/**
 * Flattens <option> and <optgroup> children (fragments and arrays too) the way a native <select>
 * reads them: an option without a value uses its text.
 */
export function readOptions(children: React.ReactNode, group?: string, groupDisabled = false): SelectOption[] {
  const out: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<OptionProps>(child)) return;
    if (child.type === Fragment) {
      out.push(...readOptions(child.props.children, group, groupDisabled));
      return;
    }
    if (child.type === 'optgroup') {
      out.push(...readOptions(child.props.children, child.props.label, !!child.props.disabled));
      return;
    }
    if (child.type !== 'option') return;
    const text = textOf(child.props.children);
    out.push({
      value: child.props.value === undefined ? text : String(child.props.value),
      label: child.props.children,
      text,
      disabled: groupDisabled || !!child.props.disabled,
      group,
    });
  });
  return out;
}

function enabled(options: SelectOption[], i: number): boolean {
  return i >= 0 && i < options.length && !options[i].disabled;
}

/** The next enabled option from `from` in `step` direction, or `from` when there is none. */
export function nextEnabled(options: SelectOption[], from: number, step: 1 | -1): number {
  for (let i = from + step; i >= 0 && i < options.length; i += step) if (enabled(options, i)) return i;
  return from;
}

export function firstEnabled(options: SelectOption[]): number {
  return nextEnabled(options, -1, 1);
}

export function lastEnabled(options: SelectOption[]): number {
  return nextEnabled(options, options.length, -1);
}

/**
 * Typeahead: the option whose text starts with `query` (case- and accent-blind for Latin, as typed
 * for Arabic). A single repeated letter cycles through the options that start with it.
 */
export function typeahead(options: SelectOption[], active: number, query: string): number {
  if (!query) return -1;
  const norm = (s: string) => s.trim().toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const q = norm(query);
  const repeated = q.length > 1 && [...q].every((c) => c === q[0]);
  const needle = repeated ? q[0] : q;
  // A new single letter (or a cycle) starts after the active option; a longer query may stay on it
  const start = needle.length === 1 ? active + 1 : Math.max(active, 0);
  for (let k = 0; k < options.length; k++) {
    const i = (start + k) % options.length;
    if (enabled(options, i) && norm(options[i].text).startsWith(needle)) return i;
  }
  return -1;
}

export type KeyResult =
  | { kind: 'open'; active: number }
  | { kind: 'move'; active: number }
  | { kind: 'select'; index: number; close: boolean }
  | { kind: 'close' }
  | { kind: 'typeahead'; char: string }
  | { kind: 'none' };

/**
 * What a key does (WAI-ARIA APG select-only combobox). Closed: ArrowDown/ArrowUp/Enter/Space/
 * Alt+ArrowDown open on the current option, Home/End open on the first/last. Open: arrows move,
 * Home/End/PageUp/PageDown jump, Enter/Space pick and close, Alt+ArrowUp picks and closes, Escape
 * closes without picking, Tab picks and lets focus move on. A printable character is typeahead.
 */
export function selectKey(
  key: string,
  opts: { open: boolean; active: number; selected: number; alt?: boolean; options: SelectOption[] },
): KeyResult {
  const { open, active, selected, options } = opts;
  const current = selected >= 0 ? selected : firstEnabled(options);
  if (!open) {
    switch (key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case ' ':
        return { kind: 'open', active: current };
      case 'Home':
        return { kind: 'open', active: firstEnabled(options) };
      case 'End':
        return { kind: 'open', active: lastEnabled(options) };
      default:
        return key.length === 1 && key !== ' ' ? { kind: 'typeahead', char: key } : { kind: 'none' };
    }
  }
  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', active: nextEnabled(options, active, 1) };
    case 'ArrowUp':
      if (opts.alt) return enabled(options, active) ? { kind: 'select', index: active, close: true } : { kind: 'close' };
      return { kind: 'move', active: nextEnabled(options, active, -1) };
    case 'Home':
      return { kind: 'move', active: firstEnabled(options) };
    case 'End':
      return { kind: 'move', active: lastEnabled(options) };
    case 'PageDown': {
      let i = active;
      for (let n = 0; n < 10; n++) i = nextEnabled(options, i, 1);
      return { kind: 'move', active: i };
    }
    case 'PageUp': {
      let i = active;
      for (let n = 0; n < 10; n++) i = nextEnabled(options, i, -1);
      return { kind: 'move', active: i };
    }
    case 'Enter':
    case ' ':
    case 'Tab':
      return enabled(options, active) ? { kind: 'select', index: active, close: true } : { kind: 'close' };
    case 'Escape':
      return { kind: 'close' };
    default:
      return key.length === 1 ? { kind: 'typeahead', char: key } : { kind: 'none' };
  }
}
