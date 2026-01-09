'use client';

import React from 'react';
import { VideoObject } from '@al-ummah/shared-types';
import VideoCard from '@/components/videoCard';
import { useLanguage } from '@/hooks/useLanguage';

interface VideoGridProps {
  videos: VideoObject[];
  loading?: boolean;
  emptyMessage?: string;
  columns?: {
    mobile?: number;
    tablet?: number;
    desktop?: number;
  };
}

export function VideoGrid({
  videos,
  loading = false,
  emptyMessage,
  columns = {
    mobile: 1,
    tablet: 2,
    desktop: 3,
  },
}: VideoGridProps) {
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
          <VideoSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (videos.length === 0) {
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
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          {emptyMessage || t.video.noVideosAvailable}
        </h3>
      </div>
    );
  }

  return (
    <div className={gridClasses} dir={isRTL ? 'rtl' : 'ltr'}>
      {videos.map((video) => (
        <VideoCard key={video.id} {...video} />
      ))}
    </div>
  );
}

function VideoSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded-lg" />
      <div className="space-y-2 p-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
      </div>
    </div>
  );
}
