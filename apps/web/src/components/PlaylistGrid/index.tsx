'use client';

import React from 'react';
import { Playlist } from '@al-ummah/shared-types';
import { PlaylistCard } from '@/components/PlaylistCard';
import { useLanguage } from '@/hooks/useLanguage';

interface PlaylistGridProps {
  playlists: Playlist[];
  loading?: boolean;
  emptyMessage?: string;
  columns?: {
    mobile?: number;
    tablet?: number;
    desktop?: number;
  };
}

export function PlaylistGrid({
  playlists,
  loading = false,
  emptyMessage,
  columns = {
    mobile: 1,
    tablet: 2,
    desktop: 3,
  },
}: PlaylistGridProps) {
  const { t, isRTL } = useLanguage();

  // Grid column classes based on breakpoints
  const gridClasses = [
    'grid',
    'gap-4',
    `grid-cols-${columns.mobile}`,
    `sm:grid-cols-${columns.tablet}`,
    `lg:grid-cols-${columns.desktop}`,
  ].join(' ');

  if (loading) {
    return (
      <div className={gridClasses}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <PlaylistSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (playlists.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <svg
          className="w-16 h-16 mb-4 text-gray-400 dark:text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          {emptyMessage || t.profile.noPlaylistsAvailable}
        </h3>
      </div>
    );
  }

  return (
    <div className={gridClasses} dir={isRTL ? 'rtl' : 'ltr'}>
      {playlists.map((playlist) => (
        <PlaylistCard key={playlist.id} {...playlist} />
      ))}
    </div>
  );
}

function PlaylistSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded-lg" />
      <div className="space-y-2 p-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
      </div>
    </div>
  );
}
