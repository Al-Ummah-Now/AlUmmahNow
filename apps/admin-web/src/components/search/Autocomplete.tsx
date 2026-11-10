'use client';

/**
 * The one autocomplete for every search and lookup box in the admin.
 *
 * - search mode: a free-text box (name="q"). Suggestions appear as the admin
 *   types; Enter still runs the full-text filter, choosing a suggestion opens it.
 * - pick mode: a field whose value is an id. The admin types a name, @handle,
 *   email or title (or pastes an id) and chooses; the id travels in a hidden
 *   input named `name`, so a GET filter form keeps the id in the URL. A chosen
 *   value shows as a chip with its picture and name.
 *
 * Accessibility: WAI-ARIA 1.2 combobox with a listbox popup (see
 * autocomplete-model.ts for the keys). The result count is announced in a
 * polite live region. Layout uses logical properties, so it is correct in RTL;
 * ids are always shown left-to-right.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { AdminSuggestion, AdminSuggestKind } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { fieldClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import {
  DEBOUNCE_MS,
  MIN_QUERY,
  closed,
  failed,
  hrefFor,
  initialState,
  keyDown,
  received,
  resolveUrl,
  suggestUrl,
  typed,
  type AutocompleteMode,
  type AutocompleteOption,
  type AutocompleteState,
} from './autocomplete-model';

export interface AutocompleteProps {
  kind: AdminSuggestKind;
  mode: AutocompleteMode;
  label: string;
  /** search: the query parameter (usually q). pick: the hidden input carrying the id. Omit for an action field. */
  name?: string;
  /** search: the text. pick: the id. */
  defaultValue?: string;
  /** pick: the chosen item when the page already has it (saves a lookup) */
  defaultItem?: AdminSuggestion | null;
  /** pick: called with the chosen id ('' when cleared) and its suggestion */
  onChange?: (id: string, item: AdminSuggestion | null) => void;
  /** pick: submit the surrounding form when a value is chosen or cleared (GET filter forms) */
  submitOnChange?: boolean;
  placeholder?: string;
  hint?: string;
  testId?: string;
  className?: string;
  disabled?: boolean;
}

const KIND_LABEL: Record<AdminSuggestKind, MessageKey> = {
  channel: 'autocomplete.kinds.channel',
  user: 'autocomplete.kinds.user',
  video: 'autocomplete.kinds.video',
  playlist: 'autocomplete.kinds.playlist',
  post: 'autocomplete.kinds.post',
  comment: 'autocomplete.kinds.comment',
  contact: 'autocomplete.kinds.contact',
  error: 'autocomplete.kinds.error',
};

type Envelope<T> = { success?: boolean; result?: T };

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok || body.success === false || !body.result) throw new Error(`Suggestions answered ${res.status}`);
  return body.result;
}

export function Autocomplete({
  kind,
  mode,
  label,
  name,
  defaultValue = '',
  defaultItem,
  onChange,
  submitOnChange = false,
  placeholder,
  hint,
  testId,
  className = '',
  disabled = false,
}: AutocompleteProps) {
  const { t } = useLanguage();
  const ids = useId();
  const inputId = `${ids}-input`;
  const listId = `${ids}-list`;
  const hintId = `${ids}-hint`;
  const optionId = (i: number) => `${ids}-opt-${i}`;

  const inputRef = useRef<HTMLInputElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [state, setState] = useState<AutocompleteState>(() => initialState(mode === 'search' ? defaultValue : ''));
  // pick mode: the chosen id and what it is (null while it is being looked up or when nothing has that id)
  const [picked, setPicked] = useState<{ id: string; item: AdminSuggestion | null; missing: boolean } | null>(() =>
    mode === 'pick' && defaultValue ? { id: defaultValue, item: defaultItem?.id === defaultValue ? defaultItem : null, missing: false } : null,
  );
  const [editing, setEditing] = useState(false);

  // Look up the name of an id that came from the URL, for the chip
  useEffect(() => {
    if (!picked || picked.item || picked.missing) return;
    const controller = new AbortController();
    getJson<{ item: AdminSuggestion | null }>(resolveUrl(kind, picked.id), controller.signal)
      .then(({ item }) => setPicked((p) => (p && p.id === picked.id ? { ...p, item, missing: !item } : p)))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        logger.warn('[Autocomplete] Could not look up the chosen item', { kind, error: error instanceof Error ? error.message : String(error) });
        setPicked((p) => (p && p.id === picked.id ? { ...p, missing: true } : p));
      });
    return () => controller.abort();
  }, [kind, picked]);

  // Ask for suggestions after the admin stops typing; a newer query aborts the older request
  const query = state.query;
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getJson<{ items: AdminSuggestion[] }>(suggestUrl(kind, q), controller.signal)
        .then(({ items }) => setState((s) => received(s, mode, q, items)))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          logger.warn('[Autocomplete] Suggestions failed', { kind, error: error instanceof Error ? error.message : String(error) });
          setState((s) => failed(s, mode, q));
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, mode, query]);

  // Keep the active option in view while arrowing through a long list
  useEffect(() => {
    if (state.active < 0) return;
    document.getElementById(optionId(state.active))?.scrollIntoView?.({ block: 'nearest' });
    // optionId is derived from a stable useId value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.active]);

  const submitForm = useCallback(() => {
    const form = (hiddenRef.current ?? inputRef.current)?.form;
    form?.requestSubmit();
  }, []);

  const setValue = useCallback(
    (id: string, item: AdminSuggestion | null) => {
      // flushSync so the hidden input holds the new id before the form is submitted
      flushSync(() => {
        setPicked(id ? { id, item, missing: false } : null);
        setEditing(false);
        setState(initialState());
      });
      onChange?.(id, item);
      if (submitOnChange) submitForm();
    },
    [onChange, submitOnChange, submitForm],
  );

  const choose = useCallback(
    (option: AutocompleteOption) => {
      if (option.type === 'searchAll') {
        flushSync(() => setState((s) => closed({ ...s, query: option.query })));
        submitForm();
        return;
      }
      if (mode === 'search') {
        // A plain navigation: the admin pages render on the server, and this keeps the box usable outside the app router
        if (option.type === 'suggestion') window.location.assign(hrefFor(option.suggestion));
        setState(closed);
        return;
      }
      if (option.type === 'suggestion') setValue(option.suggestion.id, option.suggestion);
      else setValue(option.id, null);
    },
    [mode, setValue, submitForm],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    // Escape on an empty box while changing a chosen value puts the chip back
    if (e.key === 'Escape' && mode === 'pick' && picked && !state.open && !state.query) {
      e.preventDefault();
      setEditing(false);
      return;
    }
    const result = keyDown(state, mode, e.key, e.altKey);
    if (result.preventDefault) e.preventDefault();
    setState(result.state);
    if (result.effect.type === 'choose') choose(result.effect.option);
  };

  const showChip = mode === 'pick' && picked && !editing;
  const expanded = state.open && !showChip && (state.options.length > 0 || state.status !== 'idle');
  const activeId = expanded && state.active >= 0 ? optionId(state.active) : undefined;

  const suggestionCount = state.options.filter((o) => o.type === 'suggestion').length;
  const announcement = !expanded
    ? ''
    : state.status === 'loading' && state.options.length === 0
      ? t('autocomplete.searching')
      : state.status === 'error'
        ? t('autocomplete.failed')
        : suggestionCount === 0
          ? t('autocomplete.noMatches')
          : t('autocomplete.count', { count: suggestionCount });

  return (
    <div className={`flex flex-col gap-1 ${className}`} data-testid={testId} data-mode={mode} data-kind={kind}>
      <label htmlFor={inputId} className="text-sm text-fg-muted">
        {label}
      </label>
      {mode === 'pick' && name !== undefined && <input ref={hiddenRef} type="hidden" name={name} value={picked?.id ?? ''} />}

      {showChip ? (
        <PickedChip
          picked={picked}
          kindLabel={t(KIND_LABEL[kind])}
          inputId={inputId}
          disabled={disabled}
          onChange={() => {
            flushSync(() => setEditing(true));
            inputRef.current?.focus();
          }}
          onClear={() => setValue('', null)}
          testId={testId}
        />
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            id={inputId}
            type={mode === 'search' ? 'search' : 'text'}
            name={mode === 'search' ? name : undefined}
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-describedby={hint ? hintId : undefined}
            autoComplete="off"
            spellCheck={false}
            dir="auto"
            maxLength={200}
            disabled={disabled}
            value={state.query}
            placeholder={placeholder ?? t(mode === 'search' ? 'autocomplete.searchPlaceholder' : 'autocomplete.pickPlaceholder')}
            onChange={(e) => setState((s) => typed(s, e.target.value))}
            onKeyDown={onKeyDown}
            onBlur={() => {
              setState(closed);
              // Leaving the box while changing a chosen value, with nothing typed, keeps the old value
              if (mode === 'pick' && picked && !state.query.trim()) setEditing(false);
            }}
            onFocus={() => setState((s) => (s.options.length > 0 && s.query.trim().length >= MIN_QUERY ? { ...s, open: true } : s))}
            className={`${fieldClass} w-full`}
            data-testid={testId ? `${testId}-input` : undefined}
          />
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            hidden={!expanded}
            className="absolute start-0 top-full z-30 mt-1 max-h-80 w-full min-w-72 overflow-auto rounded border border-border bg-surface py-1 shadow-lg"
            data-testid={testId ? `${testId}-list` : undefined}
          >
            {state.options.map((option, i) => (
              <li
                key={option.type === 'suggestion' ? `${option.suggestion.kind}:${option.suggestion.id}` : option.type}
                id={optionId(i)}
                role="option"
                aria-selected={i === state.active}
                // mousedown would blur the input first and close the list
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setState(closed);
                  choose(option);
                }}
                onMouseMove={() => i !== state.active && setState((s) => ({ ...s, active: i }))}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${i === state.active ? 'bg-surface-2 outline outline-2 -outline-offset-2 outline-focus' : ''}`}
                data-testid={testId ? `${testId}-option` : undefined}
                data-option={option.type}
                data-id={option.type === 'suggestion' ? option.suggestion.id : undefined}
              >
                <OptionContent option={option} kind={kind} />
              </li>
            ))}
            {state.status === 'loading' && state.options.length === 0 && <li role="presentation" className="px-3 py-2 text-sm text-fg-muted">{t('autocomplete.searching')}</li>}
          </ul>
        </div>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function Thumb({ suggestion }: { suggestion: Pick<AdminSuggestion, 'kind' | 'imageUrl' | 'label'> }) {
  const round = suggestion.kind === 'channel' || suggestion.kind === 'user';
  const size = suggestion.kind === 'video' ? 'h-9 w-16' : 'h-9 w-9';
  if (suggestion.imageUrl) {
    return <img src={suggestion.imageUrl} alt="" loading="lazy" className={`${size} shrink-0 bg-surface-2 object-cover ${round ? 'rounded-full' : 'rounded'}`} />;
  }
  const initial = Array.from(suggestion.label.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span aria-hidden="true" className={`${size} flex shrink-0 items-center justify-center bg-surface-2 font-medium text-fg-muted ${round ? 'rounded-full' : 'rounded'}`}>
      {initial}
    </span>
  );
}

function OptionContent({ option, kind }: { option: AutocompleteOption; kind: AdminSuggestKind }) {
  const { t } = useLanguage();
  if (option.type === 'searchAll') {
    return (
      <span className="text-fg">
        {t('autocomplete.searchAll')}{' '}
        <bdi className="font-medium">“{option.query}”</bdi>
      </span>
    );
  }
  if (option.type === 'useId') {
    return (
      <span className="text-fg">
        {t('autocomplete.useId', { kind: t(KIND_LABEL[kind]) })}{' '}
        <bdi dir="ltr" className="font-mono text-xs">
          {option.id}
        </bdi>
      </span>
    );
  }
  const s = option.suggestion;
  return (
    <>
      <Thumb suggestion={s} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-fg" dir="auto">
          {s.label}
        </span>
        <span className="flex min-w-0 gap-2 text-xs text-fg-muted">
          {s.secondary && (
            <span className="truncate" dir="auto">
              {s.secondary}
            </span>
          )}
          <bdi dir="ltr" className="shrink-0 font-mono">
            {s.id}
          </bdi>
        </span>
      </span>
    </>
  );
}

function PickedChip({
  picked,
  kindLabel,
  inputId,
  disabled,
  onChange,
  onClear,
  testId,
}: {
  picked: { id: string; item: AdminSuggestion | null; missing: boolean };
  kindLabel: string;
  inputId: string;
  disabled: boolean;
  onChange: () => void;
  onClear: () => void;
  testId?: string;
}) {
  const { t } = useLanguage();
  const { id, item, missing } = picked;
  const name = item?.label ?? (missing ? t('autocomplete.notFound', { kind: kindLabel }) : t('autocomplete.lookingUp'));
  return (
    <div className="flex min-h-10 items-center gap-2 rounded border border-border bg-surface-2 py-1 ps-1 pe-1" data-testid={testId ? `${testId}-chip` : undefined} data-id={id}>
      {item ? <Thumb suggestion={item} /> : <span aria-hidden="true" className="h-9 w-1" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-fg" dir="auto">
          {name}
        </span>
        <span className="flex min-w-0 gap-2 text-xs text-fg-muted">
          {item?.secondary && (
            <span className="truncate" dir="auto">
              {item.secondary}
            </span>
          )}
          <bdi dir="ltr" className="shrink-0 font-mono">
            {id}
          </bdi>
        </span>
      </span>
      <button
        type="button"
        id={inputId}
        onClick={onChange}
        disabled={disabled}
        className="rounded px-2 py-1 text-sm text-link hover:text-link-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        aria-label={t('autocomplete.changeLabel', { kind: kindLabel, name })}
        data-testid={testId ? `${testId}-change` : undefined}
      >
        {t('autocomplete.change')}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={disabled}
        className="rounded px-2 py-1 text-sm text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        aria-label={t('autocomplete.clearLabel', { kind: kindLabel, name })}
        data-testid={testId ? `${testId}-clear` : undefined}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
