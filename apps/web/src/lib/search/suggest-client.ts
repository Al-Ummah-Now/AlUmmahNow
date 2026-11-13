/**
 * Typeahead suggestions straight from the browser (GET /api/search/suggestions).
 *
 * Called on every pause in typing, so it skips the server-action round trip
 * (Next runs actions one at a time per client and can't cancel them): the
 * request goes to the public API with an AbortSignal, and a newer keystroke
 * cancels the older request.
 */

import type { SearchSuggestion } from '@al-ummah/shared-types';
import { getApiUrl } from '@/lib/runtime-config';
import { channelPath } from '@/lib/channel-url';
import { logger } from '@/lib/logger-client';

export type SuggestKind = 'video' | 'channel' | 'playlist' | 'category';

export interface SuggestRequest {
  types?: SuggestKind[];
  /** Only this channel's videos and playlists */
  channelId?: string;
  limit?: number;
  signal?: AbortSignal;
}

/** Longest text sent for a lookup (the API cuts at 100 too). */
export const SUGGEST_MAX_QUERY = 100;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Suggestions for `query`. Resolves to [] when the API fails or rate limits
 * (typing must never show an error); rejects only with an AbortError when the
 * caller cancelled.
 */
export async function fetchSuggestions(query: string, request: SuggestRequest = {}): Promise<SearchSuggestion[]> {
  const q = query.trim().slice(0, SUGGEST_MAX_QUERY);
  if (!q) return [];
  const params = new URLSearchParams({ q, limit: String(request.limit ?? 8) });
  if (request.types?.length) params.set('types', request.types.join(','));
  if (request.channelId) params.set('channelId', request.channelId);
  try {
    const response = await fetch(`${getApiUrl().replace(/\/$/, '')}/api/search/suggestions?${params}`, {
      method: 'GET',
      signal: request.signal,
    });
    if (!response.ok) {
      // 429 is expected under fast typing; anything else is worth a look
      if (response.status === 429) logger.debug('[Suggest] Rate limited', { status: response.status });
      else logger.warn('[Suggest] API error', { status: response.status });
      return [];
    }
    const data = (await response.json()) as SearchSuggestion[] | { data?: SearchSuggestion[] };
    return Array.isArray(data) ? data : data.data ?? [];
  } catch (error) {
    if (isAbort(error) || request.signal?.aborted) throw error;
    logger.warn('[Suggest] Request failed', { error });
    return [];
  }
}

/**
 * A picker's first page (and the pages after it) before anything is typed:
 * GET /api/search/suggestions with an empty q. Most viewed channels, or with
 * `channelId` that channel's newest videos/playlists. Unlike fetchSuggestions
 * it rejects when the API fails, so the picker can show an error and a retry.
 * `next` is the offset of the following page, null after the last one.
 */
export async function fetchInitialSuggestions(
  request: SuggestRequest & { offset?: number },
): Promise<{ items: SearchSuggestion[]; next: number | null }> {
  const limit = request.limit ?? 20;
  const offset = request.offset ?? 0;
  const params = new URLSearchParams({ q: '', limit: String(limit), offset: String(offset) });
  if (request.types?.length) params.set('types', request.types.join(','));
  if (request.channelId) params.set('channelId', request.channelId);
  const response = await fetch(`${getApiUrl().replace(/\/$/, '')}/api/search/suggestions?${params}`, { method: 'GET', signal: request.signal });
  if (!response.ok) throw new Error(`Suggestions answered ${response.status}`);
  const data = (await response.json()) as SearchSuggestion[] | { data?: SearchSuggestion[] };
  const items = Array.isArray(data) ? data : data.data ?? [];
  return { items, next: items.length >= limit ? offset + limit : null };
}

/** Where picking a suggestion goes; null for kinds that run a search instead (category, query). */
export function suggestionHref(suggestion: SearchSuggestion, locale: string): string | null {
  const id = suggestion.id;
  switch (suggestion.type) {
    case 'video':
      return id ? `/${locale}/video/${encodeURIComponent(id)}` : null;
    case 'channel':
      return id ? channelPath(locale, { id, handle: suggestion.handle }) : null;
    case 'playlist':
      return id ? `/${locale}/playlist/${encodeURIComponent(id)}` : null;
    default:
      return null;
  }
}
