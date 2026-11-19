'use client';

/**
 * The admin's one select (owner 2026-11-19: no native <select> anywhere in admin). A WAI-ARIA
 * select-only combobox: a button showing the chosen option and a listbox popup styled like the
 * shared Autocomplete's, kept on screen by the shared fitToViewport. It reads the same <option> /
 * <optgroup> children a native <select> takes and calls onChange with an event-shaped object
 * (`e.target.value`, `e.currentTarget.form`), so pages swap `<select>` for `<Select>` and keep their
 * handlers. With `name` it carries its value in a hidden input, so GET filter forms and server
 * actions submit it as before; a form reset restores the starting value.
 *
 * Keys (select.test.ts): closed, ArrowDown/ArrowUp/Enter/Space/Home/End open; open, arrows, Home/
 * End and PageUp/PageDown move, Enter/Space/Tab pick, Escape closes; typing a letter jumps to the
 * option starting with it. Focus stays on the button (aria-activedescendant).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { fitToViewport } from '../../../../../packages/fanous-tokens/nav/menu-fit.js';
import { fieldClass } from '@/components/ui';
import { readOptions, selectKey, typeahead, type SelectOption } from './select-logic';

export interface SelectTarget {
  value: string;
  name?: string;
  form: HTMLFormElement | null;
}

/** What onChange gets: shaped like a change event so `e.target.value` handlers keep working. */
export interface SelectChangeEvent {
  target: SelectTarget;
  currentTarget: SelectTarget;
}

type ButtonAttrs = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'defaultValue' | 'onChange' | 'children' | 'type'>;

export interface SelectProps extends ButtonAttrs {
  /** Controlled value. */
  value?: string | number;
  /** Starting value when uncontrolled. */
  defaultValue?: string | number;
  onChange?: (e: SelectChangeEvent) => void;
  /** Submitted in a hidden input under this name. */
  name?: string;
  required?: boolean;
  /** <option> and <optgroup> elements, as a native <select> takes. */
  children?: React.ReactNode;
  /** Classes for the outer wrapper (width, margins); `className` styles the button. */
  wrapperClassName?: string;
  'data-testid'?: string;
}

const TYPEAHEAD_MS = 500;

/** Classes that place the control in its row (width, margins, flex/grid placement): these go on the
 * wrapper, the rest (colours, padding, text) on the button, which fills the wrapper. */
const LAYOUT = /^(?:[a-z0-9-]+:)*!?-?(?:w-|min-w-|max-w-|flex-|grow|shrink|basis-|m[trblxyse]?-|self-|col-|row-|order-|justify-self-|place-self-)/;

export function splitClasses(className: string | undefined): { wrapper: string; button: string } {
  const wrapper: string[] = [];
  const button: string[] = [];
  for (const c of (className ?? '').split(/\s+/).filter(Boolean)) (LAYOUT.test(c) ? wrapper : button).push(c);
  return { wrapper: wrapper.join(' '), button: button.join(' ') };
}

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-fg-muted" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check({ shown }: { shown: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-4 w-4 shrink-0 ${shown ? 'text-accent' : 'invisible'}`} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Select(props: SelectProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const {
    value,
    defaultValue,
    onChange,
    name,
    required,
    children,
    className,
    wrapperClassName = '',
    disabled,
    id: idProp,
    onKeyDown: onKeyDownProp,
    onBlur: onBlurProp,
    ref: forwardedRef,
    ...rest
  } = props;
  const options = useMemo<SelectOption[]>(() => readOptions(children), [children]);
  const controlled = value !== undefined;
  const initial = useRef(defaultValue !== undefined ? String(defaultValue) : (options.find((o) => !o.disabled)?.value ?? ''));
  const [inner, setInner] = useState(initial.current);
  const current = controlled ? String(value) : inner;
  const selected = options.findIndex((o) => o.value === current);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const auto = useId();
  const id = idProp ?? `sel-${auto}`;
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hiddenRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const typed = useRef({ text: '', at: 0 });

  const setButtonRef = useCallback(
    (el: HTMLButtonElement | null) => {
      buttonRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) (forwardedRef as { current: HTMLButtonElement | null }).current = el;
    },
    [forwardedRef],
  );

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      if (option.value === current) return;
      // The hidden input must hold the new value before a handler submits the form
      if (hiddenRef.current) hiddenRef.current.value = option.value;
      if (!controlled) flushSync(() => setInner(option.value));
      const form = buttonRef.current?.closest('form') ?? null;
      const target: SelectTarget = { value: option.value, name, form };
      onChange?.({ target, currentTarget: target });
    },
    [options, current, controlled, name, onChange],
  );

  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  // A form reset puts an uncontrolled select back on its starting value, as a native one does
  useEffect(() => {
    const form = buttonRef.current?.closest('form');
    if (!form || controlled) return;
    const reset = () => setInner(initial.current);
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [controlled]);

  useLayoutEffect(() => {
    if (open) fitToViewport(listRef.current);
  }, [open]);

  // Keep the active option in view while moving through a long list
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    // optionId depends only on id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  // Close on a press outside
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const runTypeahead = (char: string, isOpen: boolean) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at > TYPEAHEAD_MS ? char : typed.current.text + char, at: now };
    const from = isOpen ? active : selected;
    const hit = typeahead(options, from, typed.current.text);
    if (hit < 0) return;
    if (isOpen) setActive(hit);
    else commit(hit);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDownProp?.(e);
    if (e.defaultPrevented || disabled) return;
    if (e.ctrlKey || e.metaKey) return;
    const result = selectKey(e.key, { open, active, selected, alt: e.altKey, options });
    switch (result.kind) {
      case 'open':
        e.preventDefault();
        openAt(result.active);
        return;
      case 'move':
        e.preventDefault();
        setActive(result.active);
        return;
      case 'select':
        if (e.key !== 'Tab') e.preventDefault();
        commit(result.index);
        setOpen(false);
        return;
      case 'close':
        if (e.key !== 'Tab') e.preventDefault();
        setOpen(false);
        return;
      case 'typeahead':
        e.preventDefault();
        runTypeahead(result.char, open);
        return;
      default:
        return;
    }
  };

  const classes = splitClasses(className ?? fieldClass);
  const shown = selected >= 0 ? options[selected] : undefined;
  const groups = options.some((o) => o.group);

  return (
    <div ref={wrapRef} className={`relative inline-flex ${classes.wrapper} ${wrapperClassName}`} data-select="">
      <button
        {...rest}
        ref={setButtonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-required={required || undefined}
        disabled={disabled}
        data-value={current}
        className={`${classes.button} inline-flex w-full min-w-0 items-center justify-between gap-2 text-start disabled:cursor-not-allowed disabled:opacity-60`}
        onClick={() => (open ? setOpen(false) : openAt(selected >= 0 ? selected : options.findIndex((o) => !o.disabled)))}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          onBlurProp?.(e);
          // Focus left for something outside (not a press inside the list, which keeps focus here)
          if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        {/* Every label stacked in one cell, only the chosen one visible: the button is as wide as the
            widest option (as a native select is), so it never jumps when the choice changes */}
        <span className="grid min-w-0">
          {options.map((o, i) => (
            <span
              key={`${o.value}-${i}`}
              aria-hidden={i !== selected || undefined}
              className={`col-start-1 row-start-1 truncate ${i === selected ? '' : 'invisible'}`}
            >
              {o.label}
            </span>
          ))}
          {!shown ? <span className="col-start-1 row-start-1">&nbsp;</span> : null}
        </span>
        <Chevron />
      </button>
      {name !== undefined ? <input ref={hiddenRef} type="hidden" name={name} value={current} readOnly /> : null}
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        // Named only while open: closed, the label names the button alone (getByLabel stays unique)
        aria-labelledby={open ? id : undefined}
        hidden={!open}
        tabIndex={-1}
        className="absolute start-0 top-full z-40 mt-1 max-h-80 min-w-full overflow-y-auto rounded border border-border bg-surface py-1 shadow-lg"
        data-testid={rest['data-testid'] ? `${rest['data-testid']}-list` : undefined}
        // Inside a <label> (dialogs wrap their fields in one), a click in the list would also
        // activate the label, which clicks the button and opens the list again over the next field
        onClick={(e) => e.preventDefault()}
      >
        {options.flatMap((o, i) => [
          groups && o.group && o.group !== options[i - 1]?.group ? (
            <li key={`g-${i}`} role="presentation" className="px-3 pb-1 pt-2 text-xs font-medium text-fg-muted">
              {o.group}
            </li>
          ) : null,
          <li
            key={`${o.value}-${i}`}
            id={optionId(i)}
            role="option"
            aria-selected={i === selected}
            aria-disabled={o.disabled || undefined}
            data-value={o.value}
            className={`flex items-center gap-2 whitespace-nowrap px-3 py-2 text-sm ${o.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-surface-2'} ${i === active ? 'bg-surface-2 outline outline-2 -outline-offset-2 outline-focus' : ''} ${groups && o.group ? 'ps-5' : ''}`}
            // Keep focus on the button (the combobox) while the list is pressed
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => !o.disabled && setActive(i)}
            onClick={() => {
              if (o.disabled) return;
              commit(i);
              setOpen(false);
              buttonRef.current?.focus();
            }}
          >
            <Check shown={i === selected} />
            <span className="min-w-0">{o.label}</span>
          </li>,
        ])}
      </ul>
    </div>
  );
}
