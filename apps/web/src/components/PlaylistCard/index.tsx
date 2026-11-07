'use client';

import React from 'react';
import Link from 'next/link';
import VideoThumbnail from '@/components/VideoThumbnail';
import { Playlist } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

export function PlaylistCard(playlist: Playlist) {
  const { lang, t } = useLanguage();

  return (
    <Link
      href={`/${lang}/playlist/${playlist.id}`}
      className="block group"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300">
        {/* Thumbnail */}
        <VideoThumbnail src={playlist.thumbnailUrl} alt={playlist.name} className="aspect-video">
          {/* Video count badge */}
          <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
            {playlist.videosCount || 0} {t.video.videos}
          </div>
        </VideoThumbnail>

        {/* Playlist details */}
        <div className="p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 line-clamp-2">
            {playlist.name}
          </h3>
          {playlist.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">
              {playlist.description}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
            {new Date(playlist.dateCreated).toLocaleDateString()}
          </p>
        </div>
      </div>
    </Link>
  );
}
