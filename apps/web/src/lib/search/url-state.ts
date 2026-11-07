/**
 * Search page URL state (Story 29.8): the query and filters live in the URL
 * (?q=&type=&duration=&date=&language=&category=&verified=&channelId=&sort=)
 * so results are shareable and the back button works.
 */

import type {
  SearchDateFilter,
  SearchDurationFilter,
  SearchEntityType,
  SearchQuery,
  SearchSort,
} from '@al-ummah/shared-types';
import { VIDEO_CATEGORIES } from '@al-ummah/shared-types';

export const SEARCH_TYPES: ReadonlyArray<SearchEntityType> = ['video', 'channel', 'playlist', 'post'];
export const SEARCH_DURATIONS: ReadonlyArray<SearchDurationFilter> = ['short', 'medium', 'long'];
export const SEARCH_DATES: ReadonlyArray<SearchDateFilter> = ['hour', 'today', 'week', 'month', 'year'];
export const SEARCH_SORTS: ReadonlyArray<SearchSort> = ['relevance', 'date', 'popular'];
export const SEARCH_LANGUAGES: ReadonlyArray<string> = ['en', 'ar', 'ur', 'fr'];

export interface SearchUrlState {
  q: string;
  type?: SearchEntityType;
  duration?: SearchDurationFilter;
  date?: SearchDateFilter;
  language?: string;
  category?: string;
  verified: boolean;
  channelId?: string;
  sort: SearchSort;
}

export const EMPTY_SEARCH_STATE: SearchUrlState = { q: '', verified: false, sort: 'relevance' };

interface ParamsLike {
  get(name: string): string | null;
}

function pick<T extends string>(value: string | null, allowed: ReadonlyArray<T>): T | undefined {
  return value && (allowed as ReadonlyArray<string>).includes(value) ? (value as T) : undefined;
}

export function parseSearchParams(params: ParamsLike | null | undefined): SearchUrlState {
  if (!params) return { ...EMPTY_SEARCH_STATE };
  const category = params.get('category');
  const channelId = params.get('channelId');
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    type: pick(params.get('type'), SEARCH_TYPES),
    duration: pick(params.get('duration'), SEARCH_DURATIONS),
    date: pick(params.get('date'), SEARCH_DATES),
    language: pick(params.get('language'), SEARCH_LANGUAGES),
    category: category && VIDEO_CATEGORIES.some(c => c.value === category) ? category : undefined,
    verified: params.get('verified') === 'true',
    channelId: channelId && /^[A-Za-z0-9_-]{1,100}$/.test(channelId) ? channelId : undefined,
    sort: pick(params.get('sort'), SEARCH_SORTS) ?? 'relevance',
  };
}

export function toSearchParams(state: SearchUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.type) params.set('type', state.type);
  if (state.duration) params.set('duration', state.duration);
  if (state.date) params.set('date', state.date);
  if (state.language) params.set('language', state.language);
  if (state.category) params.set('category', state.category);
  if (state.verified) params.set('verified', 'true');
  if (state.channelId) params.set('channelId', state.channelId);
  if (state.sort !== 'relevance') params.set('sort', state.sort);
  return params;
}

export function toSearchQuery(state: SearchUrlState, cursor?: string | null, limit = 20): SearchQuery {
  return {
    q: state.q.trim() || undefined,
    type: state.type,
    duration: state.duration,
    date: state.date,
    language: state.language,
    category: state.category,
    verified: state.verified || undefined,
    channelId: state.channelId,
    sort: state.sort,
    cursor: cursor ?? undefined,
    limit,
  };
}

/** Filters other than the type chips and sort (shown as removable chips / badge count). */
export type SearchFilterKey = 'duration' | 'date' | 'language' | 'category' | 'verified' | 'channelId';

export function activeFilterKeys(state: SearchUrlState): SearchFilterKey[] {
  const keys: SearchFilterKey[] = [];
  if (state.duration) keys.push('duration');
  if (state.date) keys.push('date');
  if (state.language) keys.push('language');
  if (state.category) keys.push('category');
  if (state.verified) keys.push('verified');
  if (state.channelId) keys.push('channelId');
  return keys;
}

export function withoutFilter(state: SearchUrlState, key: SearchFilterKey): SearchUrlState {
  if (key === 'verified') return { ...state, verified: false };
  return { ...state, [key]: undefined };
}

/** A search can run when there is text or at least one filter (mirrors the API's 400 rule). */
export function canSearch(state: SearchUrlState): boolean {
  return !!state.q.trim() || !!state.type || activeFilterKeys(state).length > 0;
}

/**
 * The duration filter only applies to videos; choosing it narrows type to video,
 * and choosing a non-video type clears it (the API does the same).
 */
export function normalizeState(state: SearchUrlState): SearchUrlState {
  if (state.duration && state.type && state.type !== 'video') return { ...state, duration: undefined };
  return state;
}
