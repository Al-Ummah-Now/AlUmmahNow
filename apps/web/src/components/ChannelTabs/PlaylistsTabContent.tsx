'use client';

import React, { useCallback } from 'react';
import { PlaylistGrid } from '@/components/PlaylistGrid';
import { useLanguage } from '@/hooks/useLanguage';
import { useCursorList } from '@/hooks/useCursorList';
import { getChannelPlaylists } from '@/lib/api/channels';
import { Playlist } from '@al-ummah/shared-types';
import { LoadMore } from './LoadMore';

const PAGE_SIZE = 24;

interface PlaylistsTabContentProps {
  channelId: string;
}

/** Every page of the tab, loaded as the viewer scrolls (useCursorList). */
export function PlaylistsTabContent({ channelId }: PlaylistsTabContentProps) {
  const { t } = useLanguage();
  const fetchPage = useCallback(async (cursor: string | undefined) => {
    const page = await getChannelPlaylists(channelId, { limit: PAGE_SIZE, cursor });
    // The API helper answers null on any failure
    if (!page) throw new Error('channel playlists unavailable');
    return page;
  }, [channelId]);
  const list = useCursorList<Playlist>(channelId, fetchPage, 'channel playlists');

  return (
    <div role="tabpanel" id="tabpanel-playlists" data-testid="tabpanel-playlists" aria-labelledby="tab-playlists">
      {list.failed ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center text-[var(--fanous-color-text-secondary)]">
          <p>{t.common.error}</p>
          <button type="button" onClick={list.retry} className="rounded-full border border-border px-5 py-2 text-sm font-semibold text-[var(--fanous-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-primary)]">
            {t.common.retry}
          </button>
        </div>
      ) : (
        <>
          <PlaylistGrid
            playlists={list.items}
            loading={list.loading}
            emptyMessage={t.profile.noPlaylistsAvailable}
          />
          <LoadMore hasMore={list.hasMore} loading={list.loadingMore} failed={list.moreFailed} onLoadMore={list.loadMore} />
        </>
      )}
    </div>
  );
}
