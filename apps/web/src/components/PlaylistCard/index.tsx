'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Playlist } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { resolveUrl } from '@/lib/utility';

export function PlaylistCard(playlist: Playlist) {
  const { lang, t } = useLanguage();

  return (
    <Link
      href={`/${lang}/playlist/${playlist.id}`}
      className="block group"
    >
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300">
        {/* Thumbnail */}
        <div className="relative aspect-video bg-gray-200 dark:bg-gray-700">
          {playlist.thumbnailUrl && (
            <Image
              src={resolveUrl(playlist.thumbnailUrl)}
              alt={playlist.name}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          )}
          {/* Video count badge */}
          <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
            {playlist.videosCount || 0} {t.video.videoViews}
          </div>
        </div>

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
