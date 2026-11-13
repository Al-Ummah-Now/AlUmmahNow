'use client';

/**
 * Continue watching (#242): the signed-in user's started, unfinished videos,
 * newest first, as a shelf on the home page. Renders nothing while signed
 * out, while history is paused, when there is nothing to continue, or when
 * the history cannot be loaded (the home page must not show an error for an
 * optional shelf).
 */

import React, { useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { PlayCircle } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { WatchHistoryService } from '@/services/api/watch-history';
import { logger } from '@/lib/logger-client';
import { LibraryVideoTile, type LibraryTileVideo } from '@/components/library/LibraryVideoTile';

export const CONTINUE_WATCHING_LIMIT = 10;

export function ContinueWatchingShelf() {
  const { user } = useAuth();
  const { t, lang, isRTL } = useLanguage();
  const [items, setItems] = useState<LibraryTileVideo[]>([]);
  const userId = user?.id;

  useEffect(() => {
    setItems([]);
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const [paused, page] = await Promise.all([
        WatchHistoryService.getPaused(),
        WatchHistoryService.list({ limit: CONTINUE_WATCHING_LIMIT, completed: false }),
      ]);
      // The service reads a malformed page as empty; this guards any other caller's shape too
      if (cancelled || paused !== false || !page || !Array.isArray(page.entries)) return;
      setItems(
        page.entries.map((e) => ({
          id: e.videoId,
          title: e.videoTitle,
          titleLocalized: e.videoTitleLocalized,
          thumbnailUrl: e.videoThumbnail,
          channelName: e.channelName,
          channelNameLocalized: e.channelNameLocalized,
          duration: e.videoDuration,
          percentWatched: e.percentageWatched,
        }))
      );
    })().catch((error) => {
      // An optional shelf: a failed load shows nothing, never an unhandled rejection
      logger.warn('[ContinueWatchingShelf] Could not load continue watching', { error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="continue-watching-heading" data-testid="continue-watching" className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="continue-watching-heading" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
          <PlayCircle className="h-5 w-5 text-[var(--fanous-color-accent)]" aria-hidden="true" />
          {t.library.continueWatching}
        </h2>
        <Link href={`/${lang}/history`} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
          {t.library.seeAll}
        </Link>
      </div>
      <ul className="flex gap-4 overflow-x-auto pb-2" dir={isRTL ? 'rtl' : 'ltr'}>
        {items.map((video) => (
          <li key={video.id} className="w-56 shrink-0">
            <LibraryVideoTile video={video} testId="continue-watching-video" />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default ContinueWatchingShelf;
