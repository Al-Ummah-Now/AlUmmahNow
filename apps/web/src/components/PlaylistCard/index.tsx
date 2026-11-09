'use client';

import React from 'react';
import Link from 'next/link';
import { PlaylistCover } from '@/components/PlaylistCover';
import { Playlist } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { getPlaylistDisplayName, getPlaylistVideoCount } from '@/lib/playlists/playlist-utils';
import { RelativeDate } from '@/components/RelativeDate';

export function PlaylistCard(playlist: Playlist) {
  const { lang, t, isRTL } = useLanguage();
  // Channel playlist listings return `title` + `videos` without the `name` / `videosCount` aliases
  const name = getPlaylistDisplayName(playlist as Playlist & { title?: string });
  const count = getPlaylistVideoCount(playlist as Playlist & { videos?: unknown });

  return (
    <Link
      href={`/${lang}/playlist/${playlist.id}`}
      className="block group"
      data-testid="playlist-card"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300">
        {/* Thumbnail */}
        <PlaylistCover playlist={playlist} alt={name}>
          {/* Video count badge */}
          <div className={`absolute bottom-2 ${isRTL ? 'left-2' : 'right-2'} bg-black/80 text-white text-xs px-2 py-1 rounded`}>
            {t.playlist.videoCount.replace('{count}', String(count))}
          </div>
        </PlaylistCover>

        {/* Playlist details */}
        <div className="p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 line-clamp-2">
            {name}
          </h3>
          {playlist.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">
              {playlist.description}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            <RelativeDate value={playlist.dateCreated} lang={lang} />
          </p>
        </div>
      </div>
    </Link>
  );
}
