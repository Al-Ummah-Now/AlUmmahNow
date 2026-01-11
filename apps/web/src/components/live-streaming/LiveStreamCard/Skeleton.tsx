/**
 * LiveStreamCard Skeleton Component
 * Task 1.3: LiveStreamCard Component (English/LTR)
 *
 * Loading skeleton that matches the exact dimensions and layout of LiveStreamCard
 * for a smooth loading experience without layout shift.
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { LiveStreamCardSkeletonProps } from './types';

/**
 * LiveStreamCardSkeleton Component
 *
 * A skeleton placeholder that matches LiveStreamCard's layout for loading states.
 * Displays animated placeholders for thumbnail, title, channel info, and metadata.
 *
 * @example
 * ```tsx
 * <LiveStreamCardSkeleton />
 * <LiveStreamCardSkeleton variant="compact" />
 * ```
 */
export const LiveStreamCardSkeleton = React.memo<LiveStreamCardSkeletonProps>(
  ({ variant = 'default', className }) => {
    return (
      <div
        className={cn(
          'relative',
          'rounded-lg overflow-hidden',
          'bg-white dark:bg-gray-900',
          'border border-gray-200 dark:border-gray-700',
          'shadow-md',
          variant === 'compact' && 'shadow-sm',
          variant === 'featured' && 'shadow-lg ring-2 ring-gray-300 dark:ring-gray-700',
          className
        )}
        role="status"
        aria-label="Loading stream card"
      >
        {/* Thumbnail Skeleton (16:9 aspect ratio) */}
        <div className="relative aspect-video bg-gray-200 dark:bg-gray-800">
          <div className="absolute inset-0 bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-700 dark:to-gray-800 animate-pulse" />

          {/* Status Badge Placeholder (top-left) */}
          <div className="absolute top-2 left-2">
            <div className="h-6 w-16 md:w-20 bg-gray-300 dark:bg-gray-700 rounded animate-pulse" />
          </div>

          {/* Viewer Count Placeholder (top-right) */}
          <div className="absolute top-2 right-2">
            <div className="h-6 w-12 md:w-16 bg-gray-300 dark:bg-gray-700 rounded animate-pulse" />
          </div>
        </div>

        {/* Content Skeleton */}
        <div className="p-3 md:p-4 space-y-2">
          {/* Title Skeleton (2 lines) */}
          <div className="space-y-1.5">
            <div className="h-4 md:h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-full" />
            <div className="h-4 md:h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4" />
          </div>

          {/* Channel Info Skeleton */}
          <div className="flex items-center gap-2">
            {/* Avatar */}
            <div className="w-6 h-6 md:w-8 md:h-8 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse flex-shrink-0" />
            {/* Channel Name */}
            <div className="h-3 md:h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-24 md:w-32" />
          </div>

          {/* Metadata Skeleton */}
          <div className="flex items-center gap-2">
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-16 md:w-20" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-20 md:w-24" />
          </div>
        </div>

        <span className="sr-only">Loading stream information</span>
      </div>
    );
  }
);

LiveStreamCardSkeleton.displayName = 'LiveStreamCardSkeleton';

export default LiveStreamCardSkeleton;
