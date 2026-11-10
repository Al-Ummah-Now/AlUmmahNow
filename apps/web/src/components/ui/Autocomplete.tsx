'use client';

/**
 * Autocomplete: the one combobox every search and lookup input uses
 * (header search, search page, in-channel search, studio pickers, team invite,
 * tags, languages, categories).
 *
 * ARIA 1.2 combobox with a listbox popup (list autocomplete, no automatic
 * selection): the input keeps focus, the highlighted option is exposed with
 * aria-activedescendant, groups are role="group" with a label, and a polite
 * live region announces how many suggestions there are.
 *
 * Keys: Down/Up move through the options (Alt+Down only opens), Enter picks
 * the highlighted option or, with none highlighted, calls onSubmit (the full
 * search), Escape closes the list and then clears the text, Tab closes,
 * Delete removes a highlighted removable option (recent searches).
 *
 * Sources: `options` are filtered and ranked locally with the same
 * normalisation as the search index (Arabic tashkeel, alef forms, taa marbuta,
 * alef maqsura); `load` is a remote lookup, debounced, cancelled when a newer
 * keystroke arrives, and cached per query for this input.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { rankSuggestions, splitHighlight } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

export interface AutocompleteOption {
  /** Unique within the list */
  id: string;
  label: string;
  /** Key of the group it is listed under (see `groups`) */
  group?: string;
  /** Second line: channel name, @handle, count… */
  subtitle?: string;
  thumbnailUrl?: string;
  /** round: avatars; wide: 16:9 video thumbnails; square: covers */
  thumbnailShape?: 'round' | 'wide' | 'square';
  /** Shown when there is no thumbnail */
  icon?: ReactNode;
  disabled?: boolean;
  /** Shown as selected (multi-pick lists) */
  selected?: boolean;
  /** Other texts that should match when filtering locally (aliases, handle, other language) */
  keywords?: Array<string | null | undefined>;
  /** Can be removed with Delete or its remove button (recent searches) */
  removable?: boolean;
  /** Anything the caller needs back in onSelect */
  value?: unknown;
}

export interface AutocompleteGroup {
  key: string;
  label: string;
}

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'role' | 'aria-expanded' | 'aria-controls' | 'aria-autocomplete' | 'aria-activedescendant' | 'onSelect' | 'onSubmit'
>;

export interface AutocompleteProps {
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (option: AutocompleteOption) => void;
  /** Enter with no option highlighted (e.g. run the full search) */
  onSubmit?: (query: string) => void;
  /** Local options, filtered and ranked as the user types */
  options?: AutocompleteOption[];
  /** Remote lookup; keep `loadKey` in sync with anything it closes over */
  load?: (query: string, signal: AbortSignal) => Promise<AutocompleteOption[]>;
  loadKey?: string;
  /** Options shown while the input is empty (recent searches, or the whole local list) */
  emptyOptions?: AutocompleteOption[];
  /** Above the options while the input is empty (e.g. "Recent searches · Clear") */
  emptyHeader?: ReactNode;
  /** Below the options while the input is empty (e.g. a privacy note) */
  emptyFooter?: ReactNode;
  /** Shown while the input is empty and there are no empty options */
  emptyText?: string;
  /** Group order and labels; options in no listed group come last, unlabelled */
  groups?: AutocompleteGroup[];
  /** Characters before a remote lookup (default 2; local lists filter from 1) */
  minChars?: number;
  debounceMs?: number;
  maxOptions?: number;
  /** The part of the text to match (e.g. the last tag of a comma list); default: all of it */
  queryOf?: (value: string) => string;
  /** Per-render state of an option (selected/disabled) that a cached lookup can't know */
  decorate?: (option: AutocompleteOption) => Partial<AutocompleteOption>;
  /** Leave the list open after a pick (multi-pick pickers) */
  keepOpenOnSelect?: boolean;
  onRemove?: (option: AutocompleteOption) => void;
  /** Hide "No matches" (e.g. free-text fields where any value is fine) */
  hideNoMatches?: boolean;
  /** overlay: popup under the input; inline: the list sits in the page flow (pickers inside dialogs) */
  mode?: 'overlay' | 'inline';
  /** Accessible name when there is no <label for> */
  label?: string;
  /** Accessible name of the listbox (defaults to `label`) */
  listLabel?: string;
  inputId?: string;
  inputClassName?: string;
  className?: string;
  popupClassName?: string;
  testId?: string;
  popupTestId?: string;
  optionTestId?: (option: AutocompleteOption) => string;
  removeTestId?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  inputProps?: NativeInputProps;
  /**
   * Render the popup into this element instead of under the input (overlay
   * mode), when the input sits in a container that clips or restyles its
   * children (the header's pill-shaped search form). The element should be
   * absolutely positionable below the input.
   */
  popupHost?: HTMLElement | null;
  /** Rendered next to the input inside the wrapper (icons, clear buttons) */
  children?: ReactNode;
  /** Extra content at the end of an option row (e.g. a Plus icon) */
  renderTrailing?: (option: AutocompleteOption, active: boolean) => ReactNode;
}

const DEFAULT_DEBOUNCE_MS = 200;
const CACHE_SIZE = 30;

/** Text with the parts that match the query in <mark>, normalisation-aware. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => splitHighlight(text, query), [text, query]);
  return (
    <>
      {parts.map((part, index) =>
        part.match
          ? <mark key={index} className="ac-mark" data-testid="autocomplete-mark">{part.text}</mark>
          : <React.Fragment key={index}>{part.text}</React.Fragment>
      )}
    </>
  );
}

function Thumbnail({ option }: { option: AutocompleteOption }) {
  const [failed, setFailed] = useState(false);
  const shape = option.thumbnailShape ?? 'square';
  const size = shape === 'wide' ? 'h-9 w-16 rounded' : shape === 'round' ? 'h-8 w-8 rounded-full' : 'h-8 w-8 rounded';
  if (option.thumbnailUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny remote thumbnails from several CDNs
      <img src={option.thumbnailUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)}
        className={`${size} shrink-0 bg-[var(--fanous-color-surface-raised,#0001)] object-cover`} />
    );
  }
  if (option.icon) return <span className="grid h-8 w-8 shrink-0 place-items-center text-[var(--fanous-color-text-muted)]" aria-hidden="true">{option.icon}</span>;
  if (option.thumbnailShape) return <span className={`${size} shrink-0 bg-[var(--fanous-color-surface-raised,#0001)]`} aria-hidden="true" />;
  return null;
}

function setRef<T>(ref: React.Ref<T> | undefined, value: T) {
  if (typeof ref === 'function') ref(value);
  else if (ref && typeof ref === 'object') (ref as React.MutableRefObject<T>).current = value;
}

export function Autocomplete(props: AutocompleteProps) {
  const {
    value, onValueChange, onSelect, onSubmit, options, load, loadKey, emptyOptions, emptyHeader, emptyFooter,
    emptyText, groups, decorate, queryOf, debounceMs = DEFAULT_DEBOUNCE_MS, maxOptions = 12, keepOpenOnSelect, onRemove,
    hideNoMatches, mode = 'overlay', label, listLabel, inputId, inputClassName, className, popupClassName,
    testId, popupTestId, optionTestId, removeTestId, inputRef, inputProps, children, renderTrailing, popupHost,
  } = props;
  const minChars = props.minChars ?? (load ? 2 : 1);
  const { t } = useLanguage();
  const a = t.autocomplete;
  const baseId = useId().replace(/:/g, '');
  const listId = `${baseId}-list`;
  const statusId = `${baseId}-status`;
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const isInside = (node: Node | null) => !!node && (!!containerRef.current?.contains(node) || !!popupRef.current?.contains(node));
  const ownInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<{ query: string; options: AutocompleteOption[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const loadRef = useRef(load);
  loadRef.current = load;
  const cacheRef = useRef(new Map<string, AutocompleteOption[]>());

  const query = (queryOf ? queryOf(value) : value).trim();
  const inline = mode === 'inline';

  // A different source (e.g. another channel) makes cached answers wrong
  useEffect(() => {
    cacheRef.current.clear();
    setRemote(null);
  }, [loadKey]);

  useEffect(() => {
    if (!loadRef.current) return;
    if (query.length < minChars) {
      setRemote(null);
      setLoading(false);
      return;
    }
    const cached = cacheRef.current.get(query);
    if (cached) {
      setRemote({ query, options: cached });
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const run = loadRef.current;
      if (!run) return;
      run(query, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          const cache = cacheRef.current;
          cache.set(query, result);
          if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
          setRemote({ query, options: result });
          setLoading(false);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          logger.warn('[Autocomplete] Lookup failed', { error });
          setRemote({ query, options: [] });
          setLoading(false);
        });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, minChars, debounceMs, loadKey]);

  const ordered = useMemo(() => {
    let list: AutocompleteOption[];
    if (!query) list = emptyOptions ?? [];
    else {
      // Local matches first; a remote lookup adds what the local list doesn't have
      const local = options ? rankSuggestions(options, query, (o) => o.label, { alternates: (o) => [o.subtitle, ...(o.keywords ?? [])] }) : [];
      const fetched = load && query.length >= minChars ? remote?.options ?? [] : [];
      const seen = new Set(local.map((o) => o.id));
      list = [...local, ...fetched.filter((o) => !seen.has(o.id))];
    }
    list = list.slice(0, maxOptions);
    if (decorate) list = list.map((o) => ({ ...o, ...decorate(o) }));
    if (!groups?.length) return list;
    const known = new Set(groups.map((g) => g.key));
    return [...groups.flatMap((g) => list.filter((o) => o.group === g.key)), ...list.filter((o) => !o.group || !known.has(o.group))];
  }, [query, emptyOptions, load, minChars, remote, options, maxOptions, groups, decorate]);

  const settled = !load || !query || !loading;
  const showNoMatches = !!query && query.length >= minChars && settled && ordered.length === 0 && !hideNoMatches;
  const showEmptyChrome = !query && (!!emptyHeader || !!emptyFooter || (!!emptyText && ordered.length === 0));
  const expanded = (inline || open) && (ordered.length > 0 || showNoMatches || showEmptyChrome);

  // Keep the highlighted option valid as the list changes
  useEffect(() => {
    setActive((i) => (i >= ordered.length ? -1 : i));
  }, [ordered.length]);

  // Announce the count once results settle (not on every keystroke while loading)
  useEffect(() => {
    if (!expanded || !settled) return;
    const count = ordered.length;
    setStatus(count === 0 ? (query ? a.noResults : '') : count === 1 ? a.oneResult : a.resultsCount.replace('{count}', String(count)));
  }, [expanded, settled, ordered.length, query, a]);

  useEffect(() => {
    if (active < 0) return;
    const el = typeof document !== 'undefined' ? document.getElementById(`${baseId}-opt-${active}`) : null;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, baseId]);

  useEffect(() => {
    if (inline) return;
    const onPointer = (event: PointerEvent) => {
      if (!isInside(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [inline]);

  const choose = useCallback((option: AutocompleteOption) => {
    if (option.disabled) return;
    if (!keepOpenOnSelect) {
      setOpen(false);
      setActive(-1);
    }
    onSelect(option);
  }, [keepOpenOnSelect, onSelect]);

  const remove = (option: AutocompleteOption) => {
    onRemove?.(option);
    setActive(-1);
    ownInputRef.current?.focus();
  };

  const move = (delta: 1 | -1) => {
    const n = ordered.length;
    if (n === 0) return;
    setActive((i) => {
      // Cycle through the options and back to the input (-1)
      let next = i;
      for (let step = 0; step <= n; step += 1) {
        next = next + delta;
        if (next >= n) next = -1;
        if (next < -1) next = n - 1;
        if (next === -1 || !ordered[next]?.disabled) return next;
      }
      return -1;
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    inputProps?.onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) setOpen(true);
        if (!event.altKey) move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) setOpen(true);
        move(-1);
        break;
      case 'Enter':
        if (expanded && active >= 0 && ordered[active]) {
          event.preventDefault();
          choose(ordered[active]);
        } else if (onSubmit) {
          event.preventDefault();
          setOpen(false);
          onSubmit(value);
        }
        break;
      case 'Escape':
        if (expanded && !inline) {
          event.preventDefault();
          setOpen(false);
          setActive(-1);
        } else if (value) {
          event.preventDefault();
          onValueChange('');
          setActive(-1);
        }
        break;
      case 'Tab':
        setOpen(false);
        setActive(-1);
        break;
      case 'Delete':
        if (active >= 0 && ordered[active]?.removable && onRemove) {
          event.preventDefault();
          remove(ordered[active]);
        }
        break;
      default:
        break;
    }
  };

  const groupLabel = (key?: string) => groups?.find((g) => g.key === key)?.label;
  // Render runs of options under their group headings, keeping the flat index for navigation
  const runs: Array<{ key: string; label?: string; items: Array<{ option: AutocompleteOption; index: number }> }> = [];
  ordered.forEach((option, index) => {
    const label = groupLabel(option.group);
    const key = label ? option.group! : '_';
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.items.push({ option, index });
    else runs.push({ key, label, items: [{ option, index }] });
  });

  const activeId = expanded && active >= 0 ? `${baseId}-opt-${active}` : undefined;

  const list = (
    <ul id={listId} role="listbox" aria-label={listLabel ?? label} className="max-h-80 overflow-y-auto py-1">
      {runs.map((run, runIndex) => {
        const items = run.items.map(({ option, index }) => {
          const isActive = index === active;
          return (
            <li key={option.id} role="presentation" className="flex items-center">
              <div
                id={`${baseId}-opt-${index}`}
                role="option"
                aria-selected={isActive}
                aria-disabled={option.disabled || undefined}
                aria-checked={option.selected === undefined ? undefined : option.selected}
                data-testid={optionTestId?.(option) ?? 'autocomplete-option'}
                data-option-id={option.id}
                data-active={isActive || undefined}
                className={`ac-option flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-sm ${isActive ? 'bg-[var(--m-hover,#0000000d)]' : ''} ${option.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                onPointerDown={(event) => event.preventDefault()}
                onMouseMove={() => { if (!isActive) setActive(index); }}
                onClick={() => choose(option)}
              >
                <Thumbnail option={option} />
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-[var(--fanous-color-text-primary)] [text-align:match-parent]">
                    <Highlight text={option.label} query={query} />
                  </span>
                  {option.subtitle && (
                    <span dir="auto" className="block truncate text-xs text-[var(--fanous-color-text-secondary)] [text-align:match-parent]">{option.subtitle}</span>
                  )}
                </span>
                {option.selected && <Check className="h-4 w-4 shrink-0 text-brand" aria-label={a.selected} />}
                {renderTrailing?.(option, isActive)}
              </div>
              {option.removable && onRemove && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={a.removeRecent.replace('{query}', option.label)}
                  data-testid={removeTestId ?? 'autocomplete-remove'}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => remove(option)}
                  className="me-2 rounded-full p-1 text-[var(--fanous-color-text-muted)] hover:bg-[var(--m-hover,#0000000d)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              )}
            </li>
          );
        });
        if (!run.label) return <React.Fragment key={`run-${runIndex}`}>{items}</React.Fragment>;
        const headingId = `${baseId}-group-${runIndex}`;
        return (
          <li key={`run-${runIndex}`} role="presentation">
            <div id={headingId} role="presentation" className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--fanous-color-text-secondary)]">{run.label}</div>
            <ul role="group" aria-labelledby={headingId}>{items}</ul>
          </li>
        );
      })}
    </ul>
  );

  // The listbox stays in the DOM (hidden) so aria-controls always points at it
  const popupNode = (
    <div
      ref={popupRef}
      data-testid={popupTestId ?? 'autocomplete-popup'}
      hidden={!expanded}
      className={inline
        ? `mt-2 overflow-hidden rounded-md border border-border ${popupClassName ?? ''}`
        : `search-dd absolute inset-x-0 top-full z-[var(--z-popover,1000)] mt-1 overflow-hidden text-start ${popupClassName ?? ''}`}
    >
      {!query && emptyHeader}
      {!query && ordered.length === 0 && emptyText && <p className="px-4 pb-3 pt-1 text-sm text-[var(--fanous-color-text-secondary)]">{emptyText}</p>}
      {list}
      {showNoMatches && (
        <p className="px-4 py-3 text-sm text-[var(--fanous-color-text-secondary)]" data-testid="autocomplete-no-matches">
          {a.noMatches.replace('{query}', query)}
        </p>
      )}
      {!query && emptyFooter}
    </div>
  );

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}
      onBlur={(event) => {
        if (!inline && !isInside(event.relatedTarget as Node | null)) setOpen(false);
      }}>
      <input
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        dir="auto"
        {...inputProps}
        ref={(el) => {
          ownInputRef.current = el;
          setRef(inputRef, el);
        }}
        id={inputId ?? inputProps?.id}
        type={inputProps?.type ?? 'text'}
        role="combobox"
        aria-label={label ?? inputProps?.['aria-label']}
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-describedby={[inputProps?.['aria-describedby'], statusId].filter(Boolean).join(' ')}
        data-testid={testId}
        value={value}
        className={inputClassName ?? inputProps?.className}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={(event) => {
          setOpen(true);
          inputProps?.onFocus?.(event);
        }}
        // autoFocus can focus before hydration; a click on an already focused input opens the list too
        onClick={(event) => {
          setOpen(true);
          inputProps?.onClick?.(event);
        }}
        onKeyDown={onKeyDown}
      />
      {children}
      <div id={statusId} role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="autocomplete-status">{status}</div>
      {popupHost && !inline ? createPortal(popupNode, popupHost) : popupNode}
    </div>
  );
}

export default Autocomplete;
