'use server';

/**
 * Server-side loader for the home page's "Your library" row (components/home/LibraryRow.tsx).
 *
 * Fetches Continue watching, Watch later, and Liked videos in parallel on the server using the
 * viewer's session cookie so the row is already in the first HTML paint (CLS 0, no flash).
 *
 * - Signed-out viewers: returns `{ cards: [], userId: null }` with zero API calls.
 * - Signed-in viewers with empty lists: returns `{ cards: [], userId }` so the client skips
 *   fetching and renders no hollow space.
 * - Partial list failures: omit the failed list (matching the client's optional-content rule).
 * - Total failure (every request failed with a network/5xx/401 error): returns `undefined` so
 *   the page can fall back cleanly without blocking or misreporting empty.
 */

import type { LibraryPage, LibraryVideo, WatchLaterPage } from '@/services/api/library';
import { apiRequestServerResult, buildApiUrl, type ApiResult, type AuthContext } from './api-client';
import { getServerAuthContext } from './server-auth';
import { FIRST_DATA_BUDGET_MS } from '@/lib/ssr/first-data';
import {
  buildContinueCard,
  buildListCard,
  LIBRARY_ROW_LOAD,
  normalizeWatchHistoryPage,
  type HomeLibraryCard,
} from '@/lib/home/library-row';
import { logger } from '@/lib/logger-server';

export interface HomeLibraryResult {
  cards: HomeLibraryCard[];
  userId: string | null;
}

const isTransportOrAuthFailure = (res: ApiResult<unknown>): boolean =>
  res.status === null || res.status === 401 || res.status >= 500;

export async function getHomeLibrary(budgetMs = FIRST_DATA_BUDGET_MS): Promise<HomeLibraryResult | undefined> {
  const auth = await getServerAuthContext();
  if (!auth?.accessToken) {
    return { cards: [], userId: null };
  }

  const getAuth = async (): Promise<AuthContext> => auth;
  const historyQuery = new URLSearchParams({
    sort: 'newest',
    limit: String(LIBRARY_ROW_LOAD),
    completed: 'false',
  }).toString();
  const listQuery = new URLSearchParams({ limit: String(LIBRARY_ROW_LOAD) }).toString();

  try {
    const [pausedRes, historyRes, watchLaterRes, likedRes] = await Promise.all([
      apiRequestServerResult<{ paused?: boolean }>(
        {
          method: 'GET',
          url: buildApiUrl('/api/watch-history/settings'),
          functionName: 'getHomeLibrary.watchHistorySettings',
          timeoutMs: budgetMs,
        },
        getAuth,
        true,
      ),
      apiRequestServerResult<unknown>(
        {
          method: 'GET',
          url: buildApiUrl(`/api/watch-history?${historyQuery}`),
          functionName: 'getHomeLibrary.watchHistoryList',
          timeoutMs: budgetMs,
        },
        getAuth,
        true,
      ),
      apiRequestServerResult<{ result?: WatchLaterPage }>(
        {
          method: 'GET',
          url: buildApiUrl(`/api/library/watch-later?${listQuery}`),
          functionName: 'getHomeLibrary.watchLater',
          timeoutMs: budgetMs,
        },
        getAuth,
        true,
      ),
      apiRequestServerResult<{ result?: LibraryPage<LibraryVideo> }>(
        {
          method: 'GET',
          url: buildApiUrl(`/api/library/liked?${listQuery}`),
          functionName: 'getHomeLibrary.liked',
          timeoutMs: budgetMs,
        },
        getAuth,
        true,
      ),
    ]);

    const continueFailed = isTransportOrAuthFailure(pausedRes) || isTransportOrAuthFailure(historyRes);
    const watchLaterFailed = isTransportOrAuthFailure(watchLaterRes);
    const likedFailed = isTransportOrAuthFailure(likedRes);

    // If every list failed (API down, timed out, or unrecoverable 401), treat the server load as
    // unavailable rather than wrongly claiming the user's library is empty.
    if (continueFailed && watchLaterFailed && likedFailed) {
      logger.warn('[getHomeLibrary] All library requests failed on server', {
        statuses: {
          paused: pausedRes.status,
          history: historyRes.status,
          watchLater: watchLaterRes.status,
          liked: likedRes.status,
        },
      });
      return undefined;
    }

    const paused = pausedRes.data ? pausedRes.data.paused === true : null;
    const historyPage = historyRes.data ? normalizeWatchHistoryPage(historyRes.data) : null;

    const cards: HomeLibraryCard[] = [];
    const continueCard = buildContinueCard(paused, historyPage);
    if (continueCard) cards.push(continueCard);
    const watchLaterCard = buildListCard('watch-later', watchLaterRes.data?.result);
    if (watchLaterCard) cards.push(watchLaterCard);
    const likedCard = buildListCard('liked', likedRes.data?.result);
    if (likedCard) cards.push(likedCard);

    return { cards, userId: auth.userId ?? null };
  } catch (error) {
    logger.warn('[getHomeLibrary] Failed to load home library on server', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
