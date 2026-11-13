'use client';

/**
 * Pick a videos user by typing their email, name, @handle or id (the WAI-ARIA
 * combobox pattern with a listbox popup). Searches server side after a short
 * pause once 2+ characters are typed; ArrowUp/ArrowDown move, Home/End jump,
 * Enter chooses, Escape closes the list (or clears the field when it is
 * already closed). The chosen user replaces the field with a card and a
 * "Choose someone else" button.
 */
import { useEffect, useId, useLayoutEffect, useReducer, useRef } from 'react';
import { fitToViewport } from '../../../../../packages/fanous-tokens/nav/menu-fit.js';
import type { AdminUserSearchItem } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { smallButtonClass } from './parts';
import { SEARCH_DEBOUNCE_MS, initialPickerState, pickerReducer, selectable, statusText, userMeta, userName } from './userPickerModel';

interface Props {
  label: string;
  hint?: string;
  /** Runs the search (a server action); its items are already without the excluded users. */
  search: (query: string) => Promise<ActionResult<{ items: AdminUserSearchItem[] }>>;
  value: AdminUserSearchItem | null;
  onChange: (user: AdminUserSearchItem | null) => void;
  disabled?: boolean;
  testId: string;
  /** Open with search('') before anything is typed (the transfer lists the channel's team). Default on. */
  initialResults?: boolean;
}

function Avatar({ user }: { user: AdminUserSearchItem }) {
  const initial = userName(user).replace(/^@/, '').charAt(0).toUpperCase() || '?';
  return user.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote avatar from the images CDN
    <img src={user.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover bg-surface-2" />
  ) : (
    <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-full bg-surface-2 border border-border flex items-center justify-center text-sm font-semibold text-fg-muted">
      {initial}
    </span>
  );
}

function UserSummary({ user }: { user: AdminUserSearchItem }) {
  const { t } = useLanguage();
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar user={user} />
      <span className="min-w-0">
        <span className="block font-medium text-fg truncate" dir="auto">
          {userName(user)}
          {user.userName && user.displayName && (
            <span className="ms-2 text-fg-muted font-normal" dir="ltr">
              @{user.userName}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-xs text-fg-muted min-w-0">
          <span className="truncate" dir="ltr">{user.email || t('channels.pickerNoEmail')}</span>
          {user.invite && user.invite.status !== 'active' && user.invite.status !== 'revoked' && (
            <span className="shrink-0 rounded-full border border-border bg-surface-2 px-2 text-fg-muted" data-testid="user-picker-invited">
              {t('invites.badge')}
            </span>
          )}
        </span>
        <span className={`block text-xs ${user.isBanned ? 'text-danger-fg' : 'text-fg-subtle'}`}>{userMeta(user, t)}</span>
      </span>
    </span>
  );
}

export function UserPicker({ label, hint, search, value, onChange, disabled, testId, initialResults = true }: Props) {
  const { t } = useLanguage();
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const [state, dispatch] = useReducer(pickerReducer, initialPickerState);
  const latest = useRef('');
  const listId = `${ids}-list`;
  const statusId = `${ids}-status`;
  const hintId = `${ids}-hint`;
  const optionId = (i: number) => `${ids}-opt-${i}`;

  // Debounced search: only the answer to the latest query is used
  useEffect(() => {
    if (state.status !== 'loading' || state.answered === state.query) return;
    const query = state.query;
    latest.current = query;
    const timer = window.setTimeout(async () => {
      let result: ActionResult<{ items: AdminUserSearchItem[] }>;
      try {
        result = await search(query);
      } catch (error) {
        logger.error('[UserPicker] Search request failed', { error: error instanceof Error ? error.message : String(error) });
        result = { ok: false, status: 0, error: 'request failed' };
      }
      if (latest.current !== query) return;
      if (result.ok) dispatch({ type: 'results', query, results: result.data.items });
      else {
        logger.warn('[UserPicker] Search failed', { status: result.status, code: result.code });
        dispatch({ type: 'failed', query });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state.query, state.status, state.answered, search]);

  function choose(user: AdminUserSearchItem) {
    if (!selectable(user)) return;
    onChange(user);
    dispatch({ type: 'reset' });
    // The field is replaced by the chosen user's card: keep focus nearby
    window.setTimeout(() => changeRef.current?.focus(), 0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        dispatch({ type: 'move', by: e.key === 'ArrowDown' ? 1 : -1 });
        break;
      case 'Home':
      case 'End':
        if (state.open && state.results.length) {
          e.preventDefault();
          dispatch({ type: 'edge', to: e.key === 'Home' ? 'first' : 'last' });
        }
        break;
      case 'Enter':
        // Never submits a surrounding form: Enter only chooses
        e.preventDefault();
        if (state.open && state.active >= 0) choose(state.results[state.active]);
        break;
      case 'Escape':
        if (state.open) {
          e.preventDefault();
          dispatch({ type: 'close' });
        } else if (state.query) {
          e.preventDefault();
          dispatch({ type: 'reset' });
        }
        break;
      case 'Tab':
        dispatch({ type: 'close' });
        break;
    }
  }

  const status = statusText(state, t);
  const showList = state.open && state.status === 'done' && state.results.length > 0;
  // Never past the screen's bottom (docs/design/NAV.md)
  const listRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    if (showList) fitToViewport(listRef.current);
  }, [showList]);

  if (value) {
    return (
      <div className="flex flex-col gap-1" data-testid={testId} data-selected-id={value.id}>
        <span className="text-sm text-fg-muted" id={`${ids}-label`}>
          {label}
        </span>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface-2 p-3" role="group" aria-labelledby={`${ids}-label`} data-testid={`${testId}-selected`}>
          <UserSummary user={value} />
          <button
            ref={changeRef}
            type="button"
            className={smallButtonClass}
            disabled={disabled}
            onClick={() => {
              onChange(null);
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
            data-testid={`${testId}-change`}
          >
            {t('channels.pickerChange')}
          </button>
        </div>
        <span className="sr-only" aria-live="polite">
          {t('channels.pickerSelected', { name: userName(value) })}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 relative" data-testid={testId}>
      <label htmlFor={`${ids}-input`} className="text-sm text-fg-muted">
        {label}
      </label>
      <input
        ref={inputRef}
        id={`${ids}-input`}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && state.active >= 0 ? optionId(state.active) : undefined}
        aria-describedby={`${hint ? `${hintId} ` : ''}${statusId}`}
        autoComplete="off"
        spellCheck={false}
        dir="auto"
        maxLength={200}
        placeholder={t('channels.newOwnerPlaceholder')}
        value={state.query}
        disabled={disabled}
        onChange={(e) => dispatch({ type: 'type', query: e.target.value, browse: initialResults })}
        onKeyDown={onKeyDown}
        onFocus={() => dispatch(initialResults ? { type: 'browse' } : { type: 'open' })}
        onClick={() => {
          if (initialResults && !state.open) dispatch({ type: 'browse' });
        }}
        onBlur={() => dispatch({ type: 'close' })}
        className={`${fieldClass} w-full`}
        data-testid={`${testId}-input`}
      />
      {hint && (
        <span id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </span>
      )}
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!showList}
        className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded border border-border bg-surface shadow-lg"
        data-testid={`${testId}-list`}
      >
        {showList &&
          state.results.map((user, i) => (
            <li
              key={user.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === state.active}
              aria-disabled={!selectable(user) || undefined}
              className={`px-3 py-2 border-b border-border last:border-b-0 ${
                !selectable(user) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
              } ${i === state.active ? 'bg-accent/10 outline outline-2 -outline-offset-2 outline-focus' : 'hover:bg-surface-2'}`}
              // Keep focus in the field so the list stays a popup of it
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => dispatch({ type: 'hover', index: i })}
              onClick={() => choose(user)}
              data-testid={`${testId}-option`}
              data-user-id={user.id}
            >
              <UserSummary user={user} />
            </li>
          ))}
      </ul>
      <span
        id={statusId}
        role="status"
        aria-live="polite"
        className={`text-xs ${state.status === 'error' ? 'text-danger-fg' : 'text-fg-muted'} min-h-4`}
        data-testid={`${testId}-status`}
        data-status={state.status}
      >
        {status}
      </span>
    </div>
  );
}
