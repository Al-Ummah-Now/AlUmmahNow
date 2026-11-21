'use client';

/**
 * Continue watching (#242, owner 2026-11-21): on the home page, ONE playlist-style card for the
 * signed-in user's started, unfinished videos. Its cover is the newest one's thumbnail with the
 * shared stacked sheets, a compact count badge and that video's progress; the card opens the history
 * page's Continue watching view, and its Resume link opens the newest video, which resumes where it
 * stopped. Renders nothing while signed out, while history is paused, when there is nothing to
 * continue, or when the history cannot be loaded (an optional card never shows an error).
 */

import React, { useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { Play } from 'lucide-react';
import { formatNumber } from '@al-ummah/shared-types';
import VideoThumbnail, { THUMBNAIL_16_9 } from '@/components/VideoThumbnail';
import { PlaylistCardFrame } from '@/components/PlaylistCard/PlaylistCardFrame';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { WatchHistoryService, entryTitle, type WatchHistoryItem } from '@/services/api/watch-history';
import { formatVideoCount, keepNumbersWithUnits, metaSeparator } from '@/lib/format/videoMeta';
import { removeUnwantedChars } from '@/lib/utility';
import { logger } from '@/lib/logger-client';
import '@/theme/home-rails.css';

interface ContinueState {
  top: WatchHistoryItem;
  total: number;
}

export function ContinueWatchingShelf() {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const [state, setState] = useState<ContinueState | null>(null);
  const userId = user?.id;

  useEffect(() => {
    setState(null);
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      // The newest unfinished video and how many there are (`total` counts the filtered list)
      const [paused, page] = await Promise.all([
        WatchHistoryService.getPaused(),
        WatchHistoryService.list({ limit: 1, completed: false }),
      ]);
      // The service reads a malformed page as empty; this guards any other caller's shape too
      if (cancelled || paused !== false || !page || !Array.isArray(page.entries) || page.entries.length === 0) return;
      setState({ top: page.entries[0], total: Math.max(page.total || 0, page.entries.length) });
    })().catch((error) => {
      // An optional card: a failed load shows nothing, never an unhandled rejection
      logger.warn('[ContinueWatchingShelf] Could not load continue watching', { error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!state) return null;

  const { top, total } = state;
  const title = removeUnwantedChars(entryTitle(top, lang));
  const percent = Math.max(0, Math.min(100, Math.round(top.percentageWatched || 0)));
  const watched = keepNumbersWithUnits(t.watchHistory.percentWatched.replace('{percent}', formatNumber(lang, percent)));

  return (
    <section aria-label={t.library.continueWatching} data-testid="continue-watching" data-video-id={top.videoId} className="hcw">
      <PlaylistCardFrame
        href={`/${lang}/history?view=continue`}
        testId="continue-watching-card"
        title={t.library.continueWatching}
        countLabel={formatVideoCount(total, lang, { compact: true })}
        progress={percent}
        cover={(overlay) => (
          <VideoThumbnail src={top.videoThumbnail} alt="" style={THUMBNAIL_16_9}>
            {overlay}
          </VideoThumbnail>
        )}
        meta={
          <p className="plc-meta" data-testid="continue-watching-meta">
            <strong dir="auto">{title}</strong>
            {metaSeparator(lang)}
            <span className="whitespace-nowrap">{watched}</span>
          </p>
        }
        action={
          <Link
            href={`/${lang}/video/${encodeURIComponent(top.videoId)}`}
            data-testid="continue-watching-resume"
            aria-label={t.watchHistory.resumeTopLabel.replace('{title}', title)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--fanous-color-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--fanous-color-on-primary)] shadow hover:bg-[var(--fanous-color-primary-hover)] hover:text-[var(--fanous-color-on-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)]"
          >
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            {t.watchHistory.resumeTop}
          </Link>
        }
      />
    </section>
  );
}

export { ContinueWatchingShelf as ContinueWatchingCard };
export default ContinueWatchingShelf;
