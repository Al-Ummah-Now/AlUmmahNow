/**
 * State of the user picker combobox (UserPicker.tsx), kept free of React and
 * the DOM so the keyboard and search rules are unit tested on their own.
 */
import { ADMIN_USER_SEARCH_MIN_LENGTH, type AdminUserSearchItem } from '@al-ummah/shared-types';
import type { MessageKey, Translator } from '@/i18n/translate';

export const SEARCH_DEBOUNCE_MS = 250;
export const MIN_QUERY_LENGTH = ADMIN_USER_SEARCH_MIN_LENGTH;

export type SearchStatus = 'idle' | 'short' | 'loading' | 'done' | 'error';

export interface PickerState {
  query: string;
  status: SearchStatus;
  results: AdminUserSearchItem[];
  /** Index of the highlighted option, -1 for none. */
  active: number;
  open: boolean;
  /** The query `results` answer (stale answers are dropped). */
  answered: string;
}

export const initialPickerState: PickerState = { query: '', status: 'idle', results: [], active: -1, open: false, answered: '' };

export type PickerAction =
  | { type: 'type'; query: string }
  | { type: 'loading'; query: string }
  | { type: 'results'; query: string; results: AdminUserSearchItem[] }
  | { type: 'failed'; query: string }
  | { type: 'move'; by: 1 | -1 }
  | { type: 'edge'; to: 'first' | 'last' }
  | { type: 'hover'; index: number }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'reset' };

/** The term the server searches (leading "@" ignored, as the API does). */
export const searchable = (query: string) => query.trim().replace(/^@+/, '').trim();

/** Whether a query is long enough to search. */
export const canSearch = (query: string) => searchable(query).length >= MIN_QUERY_LENGTH;

/** Users that can be chosen: banned users are listed but cannot receive a channel. */
export const selectable = (user: AdminUserSearchItem) => !user.isBanned;

/** The next selectable option from `from` in direction `by`, wrapping; -1 when none can be chosen. */
export function step(results: AdminUserSearchItem[], from: number, by: 1 | -1): number {
  const n = results.length;
  let i = from;
  for (let k = 0; k < n; k++) {
    // From nothing, ArrowDown starts at the first option and ArrowUp at the last
    i = i === -1 ? (by === 1 ? 0 : n - 1) : (i + by + n) % n;
    if (selectable(results[i])) return i;
  }
  return -1;
}

export function pickerReducer(state: PickerState, action: PickerAction): PickerState {
  switch (action.type) {
    case 'type': {
      const status: SearchStatus = action.query.trim() === '' ? 'idle' : canSearch(action.query) ? 'loading' : 'short';
      return { ...state, query: action.query, status, open: action.query.trim() !== '', active: -1, ...(status === 'loading' ? {} : { results: [], answered: '' }) };
    }
    case 'loading':
      return action.query === state.query ? { ...state, status: 'loading' } : state;
    case 'results':
      if (action.query !== state.query) return state;
      return { ...state, status: 'done', results: action.results, answered: action.query, active: step(action.results, -1, 1), open: true };
    case 'failed':
      return action.query === state.query ? { ...state, status: 'error', results: [], active: -1 } : state;
    case 'move':
      if (!state.open) return { ...state, open: state.query.trim() !== '' };
      return { ...state, active: step(state.results, state.active, action.by) };
    case 'edge': {
      if (!state.open || state.results.length === 0) return state;
      return { ...state, active: step(state.results, -1, action.to === 'first' ? 1 : -1) };
    }
    case 'hover':
      return state.results[action.index] && selectable(state.results[action.index]) ? { ...state, active: action.index } : state;
    case 'open':
      return { ...state, open: state.query.trim() !== '' };
    case 'close':
      return { ...state, open: false };
    case 'reset':
      return initialPickerState;
  }
}

/** The status line read to screen readers (and shown under the field). */
export function statusText(state: PickerState, t: Translator): string {
  switch (state.status) {
    case 'short':
      return t('channels.pickerMinChars', { count: MIN_QUERY_LENGTH });
    case 'loading':
      return t('channels.pickerLoading');
    case 'error':
      return t('channels.pickerError');
    case 'done':
      return state.results.length === 0 ? t('channels.pickerEmpty', { query: state.query.trim() }) : t('channels.pickerResults', { count: state.results.length });
    default:
      return '';
  }
}

/** "Owns 2 channels · Channel editor here" (or banned). */
export function userMeta(user: AdminUserSearchItem, t: Translator): string {
  const parts = [
    user.channelCount === 0 ? t('channels.pickerOwnsNone') : user.channelCount === 1 ? t('channels.pickerOwnsOne') : t('channels.pickerOwnsMany', { count: user.channelCount }),
  ];
  if (user.channelRole) {
    const key = `channels.memberRoles.${user.channelRole}` as MessageKey;
    const role = t(key);
    parts.push(t('channels.pickerRole', { role: role === key ? user.channelRole : role }));
  }
  if (user.isBanned) parts.push(t('channels.pickerBanned'));
  return parts.join(' · ');
}

/** What the user is called in the confirm dialog and status lines. */
export const userName = (user: Pick<AdminUserSearchItem, 'displayName' | 'userName' | 'email' | 'id'>) =>
  user.displayName || (user.userName ? `@${user.userName}` : '') || user.email || user.id;

/** Values the admin may type to confirm a transfer: the channel's @handle (with or without "@") or the new owner's email. */
export function transferConfirmValues(handle: string | null, email: string | null): string[] {
  const values: string[] = [];
  if (handle) values.push(`@${handle}`, handle);
  if (email) values.push(email);
  return values;
}

/** Whether `typed` matches one of the confirm values (emails ignore case). */
export function confirmMatches(typed: string, values: readonly string[]): boolean {
  const v = typed.trim();
  if (!v) return false;
  return values.some((value) => (value.includes('@') && !value.startsWith('@') ? value.toLowerCase() === v.toLowerCase() : value === v));
}
