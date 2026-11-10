'use client';

import React, { useCallback } from 'react';
import { VideoGrid } from '@/components/VideoGrid';
import { useLanguage } from '@/hooks/useLanguage';
import { useCursorList } from '@/hooks/useCursorList';
import { getChannelLiveStreams } from '@/lib/api/channels';
import { VideoObject } from '@al-ummah/shared-types';
import { LoadMore } from './LoadMore';

const PAGE_SIZE = 24;

interface LiveTabContentProps {
  channelId: string;
}

/** Every page of the tab, loaded as the viewer scrolls (useCursorList). */
export function LiveTabContent({ channelId }: LiveTabContentProps) {
  const { t } = useLanguage();
  const fetchPage = useCallback(async (cursor: string | undefined) => {
    const page = await getChannelLiveStreams(channelId, { limit: PAGE_SIZE, cursor });
    // The API helper answers null on any failure
    if (!page) throw new Error('channel live streams unavailable');
    return page;
  }, [channelId]);
  const list = useCursorList<VideoObject>(channelId, fetchPage, 'channel live streams');

  return (
    <div role="tabpanel" id="tabpanel-live" data-testid="tabpanel-live" aria-labelledby="tab-live">
      {list.failed ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center text-[var(--fanous-color-text-secondary)]">
          <p>{t.common.error}</p>
          <button type="button" onClick={list.retry} className="rounded-full border border-border px-5 py-2 text-sm font-semibold text-[var(--fanous-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-primary)]">
            {t.common.retry}
          </button>
        </div>
      ) : (
        <>
          <VideoGrid
            videos={list.items}
            loading={list.loading}
            emptyMessage={t.channel.liveNowDescription}
          />
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} failed={list.moreFailed} onLoadMore={list.loadMore} />
        </>
      )}
    </div>
  );
}
