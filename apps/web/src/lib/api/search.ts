'use server';

/**
 * Search v2 and Explore API (Epic 29, Stories 29.7 and 29.8)
 * GET /api/search, GET /api/explore
 */

import type { ExploreResponse, SearchQuery, SearchResponse } from '@al-ummah/shared-types';
import { buildApiUrl } from './api-client';
import { logger } from '@/lib/logger-server';

export type SearchResult =
  | { ok: true; data: SearchResponse }
  | { ok: false; status: number };

function toParams(query: SearchQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.type) params.set('type', query.type);
  if (query.duration) params.set('duration', query.duration);
  if (query.date) params.set('date', query.date);
  if (query.language) params.set('language', query.language);
  if (query.category) params.set('category', query.category);
  if (query.verified) params.set('verified', 'true');
  if (query.channelId) params.set('channelId', query.channelId);
  if (query.sort && query.sort !== 'relevance') params.set('sort', query.sort);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  return params;
}

/**
 * Search the index. Public endpoint: no auth header is sent so results are cacheable.
 */
export async function searchContent(query: SearchQuery): Promise<SearchResult> {
  const params = toParams(query);
  try {
    const response = await fetch(buildApiUrl(`/api/search?${params.toString()}`), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      logger.warn('[searchContent] API error', { status: response.status, params: params.toString() });
      return { ok: false, status: response.status };
    }
    const data = (await response.json()) as SearchResponse;
    logger.info('[searchContent] Search served', { params: params.toString(), count: data.results?.length ?? 0 });
    return { ok: true, data: { ...data, results: data.results ?? [] } };
  } catch (error) {
    logger.error('[searchContent] Request failed', { error, params: params.toString() });
    return { ok: false, status: 0 };
  }
}

/**
 * Explore page data: categories with counts, new channels, active seasonal rails.
 */
export async function getExploreData(language?: string): Promise<ExploreResponse | null> {
  const params = new URLSearchParams();
  if (language) params.set('language', language);
  try {
    const response = await fetch(buildApiUrl(`/api/explore${params.size ? `?${params}` : ''}`), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      logger.warn('[getExploreData] API error', { status: response.status, language });
      return null;
    }
    return (await response.json()) as ExploreResponse;
  } catch (error) {
    logger.error('[getExploreData] Request failed', { error, language });
    return null;
  }
}
