/**
 * Server-side loader for the home page's "Your library" row (components/home/LibraryRow.tsx).
 * Plain server module (not a Server Action: only invoked by app/[locale]/page.tsx).
 *
 * Fetches Continue watching, Watch later, and Liked videos in parallel on the server using the
 * viewer's session cookie so the row is already in the first HTML paint (CLS 0, no flash).
 *
 * - Signed-out viewers: returns `{ cards: [], userId: null }` with zero API calls.
 * - Signed-in viewers with empty lists: returns `{ cards: [], userId }` so the client skips
 *   fetching and renders no hollow space.
 * - Continue-watching covers: watch-history entries carry no `isPublic` flag, so any signed
 *   thumbnail on the up-to-3 Continue-watching entries not already known public from Watch later
 *   or Liked is verified anonymously via `loadPublicVideo` within the remaining budget and mapped
 *   to `/thumb/<id>.jpg`. Public videos not in today's feed still render with their cover on first
 *   paint and trigger zero client fetches; private videos stay signed so `stableImages` strips them.
 * - Partial list failures: omit the failed list (matching the client's optional-content rule).
 * - Total failure (every request failed with a network/5xx/401 error): returns `undefined` so
 *   the page can fall back cleanly without blocking or misreporting empty.
 */

import type { LibraryPage, LibraryVideo, WatchLaterPage } from '@/services/api/library';
import { apiRequestServerResult, buildApiUrl, type ApiResult, type AuthContext } from './api-client';
import { getServerAuthContext } from './server-auth';
import { loadPublicVideo } from '@/lib/embed/content';
import { FIRST_DATA_BUDGET_MS, withinBudget } from '@/lib/ssr/first-data';
import { hasStableThumb, isSignedMediaUrl } from '@/lib/ssr/stable-images';
import { parseWatchHistoryPage } from '@/lib/watch-history/parse-page';
import {
  buildContinueCard,
  buildListCard,
  LIBRARY_ROW_LOAD,
  withPublicHistoryThumbs,
  type HomeLibraryCard,
} from '@/lib/home/library-row';
import { logger } from '@/lib/logger-server';

export interface HomeLibraryResult {
  cards: HomeLibraryCard[];
  userId: string | null;
}

const isTransportOrAuthFailure = (res: ApiResult<unknown>): boolean =>
  res.status === null || res.status === 401 || res.status >= 500;

/** Margin reserved before `budgetMs` so a slow cover lookup never trips the page's outer `withinBudget` timer. */
export const THUMB_LOOKUP_MARGIN_MS = 200;

/** Minimum remaining budget (ms) before doing anonymous visibility lookups for history thumbnails. */
const MIN_THUMB_LOOKUP_BUDGET_MS = 50;

export async function getHomeLibrary(budgetMs = FIRST_DATA_BUDGET_MS): Promise<HomeLibraryResult | undefined> {
  const deadline = Date.now() + budgetMs;
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
    const historyPage = historyRes.data ? parseWatchHistoryPage(historyRes.data).page : null;

    const cards: HomeLibraryCard[] = [];
    const continueCard = buildContinueCard(paused, historyPage);
    if (continueCard) cards.push(continueCard);
    const watchLaterCard = buildListCard('watch-later', watchLaterRes.data?.result);
    if (watchLaterCard) cards.push(watchLaterCard);
    const likedCard = buildListCard('liked', likedRes.data?.result);
    if (likedCard) cards.push(likedCard);

    if (continueCard) {
      const publicIds = new Set<string>();
      for (const card of [watchLaterCard, likedCard]) {
        if (!card) continue;
        for (const v of [card.top, ...card.next]) {
          if (hasStableThumb(v) && v.id) publicIds.add(v.id);
        }
      }

      const unknownSignedIds = [
        ...new Set(
          [continueCard.top, ...continueCard.next]
            .filter((e) => typeof e.videoThumbnail === 'string' && isSignedMediaUrl(e.videoThumbnail) && !publicIds.has(e.videoId))
            .map((e) => e.videoId),
        ),
      ];

      const remaining = deadline - THUMB_LOOKUP_MARGIN_MS - Date.now();
      if (unknownSignedIds.length > 0 && remaining >= MIN_THUMB_LOOKUP_BUDGET_MS) {
        const resolved = await Promise.all(
          unknownSignedIds.map((id) =>
            withinBudget(async () => ((await loadPublicVideo(id))?.poster ? id : null), remaining),
          ),
        );
        for (const id of resolved) {
          if (id) publicIds.add(id);
        }
      }

      return { cards: withPublicHistoryThumbs(cards, publicIds), userId: auth.userId ?? null };
    }

    return { cards, userId: auth.userId ?? null };
  } catch (error) {
    logger.warn('[getHomeLibrary] Failed to load home library on server', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
