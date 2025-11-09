/**
 * LiveStreamCard Component (LTR)
 * Task 1.3: LiveStreamCard Component (English/LTR)
 *
 * A comprehensive, interactive card component that displays live stream preview information
 * in a mobile-first, accessible layout with support for hover states and loading states.
 */

'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { Play, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StreamStatusBadge } from '../StreamStatusBadge';
import { ViewerCount } from '../ViewerCount';
import type { LiveStreamCardProps } from './types';

/**
 * Format relative time from date
 * Examples: "2 hours ago", "Started 30 minutes ago"
 */
function formatRelativeTime(date: Date | undefined, prefix: string = ''): string | null {
  if (!date) return null;

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${prefix}${days}d ago`;
  }
  if (hours > 0) {
    return `${prefix}${hours}h ago`;
  }
  if (minutes > 0) {
    return `${prefix}${minutes}m ago`;
  }
  return `${prefix}Just now`;
}

/**
 * LiveStreamCard Component
 *
 * Displays a preview card for a live stream with thumbnail, status, viewer count,
 * channel information, and interactive hover states.
 *
 * Features:
 * - 16:9 aspect ratio thumbnail
 * - Live status badge overlay
 * - Viewer count overlay (for live streams)
 * - Play button on hover
 * - Channel avatar and name
 * - Stream title (2 lines max)
 * - Category and relative time metadata
 * - Error handling for failed image loads
 * - Lazy loading with priority option
 * - Dark mode support
 * - Mobile-first responsive design
 * - Fully accessible with ARIA labels
 *
 * @example
 * ```tsx
 * <LiveStreamCard
 *   stream={liveStream}
 *   onPlay={() => router.push(`/en/live/${stream.id}`)}
 *   priority={index < 4}
 * />
 * ```
 */
export const LiveStreamCard = React.memo<LiveStreamCardProps>(
  ({
    stream,
    variant = 'default',
    showChannel = true,
    showViewers = true,
    onPlay,
    className,
    priority = false,
  }) => {
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);

    // Memoize formatted values
    const relativeTime = useMemo(() => {
      if (stream.status === 'live' && stream.startedAt) {
        return formatRelativeTime(stream.startedAt, 'Started ');
      }
      if (stream.status === 'scheduled' && stream.scheduledStartTime) {
        const now = new Date();
        const scheduled = stream.scheduledStartTime;
        if (scheduled > now) {
          const diff = scheduled.getTime() - now.getTime();
          const hours = Math.floor(diff / (1000 * 60 * 60));
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          if (hours > 0) {
            return `Starts in ${hours}h ${minutes}m`;
          }
          return `Starts in ${minutes}m`;
        }
      }
      if (stream.status === 'ended' && stream.endedAt) {
        return formatRelativeTime(stream.endedAt, 'Ended ');
      }
      return null;
    }, [stream.status, stream.startedAt, stream.scheduledStartTime, stream.endedAt]);

    const handleClick = useCallback(() => {
      if (onPlay) {
        onPlay();
      }
    }, [onPlay]);

    const handleKeyPress = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      },
      [handleClick]
    );

    const ariaLabel = `Live stream: ${stream.title} by ${stream.channel.name}${
      stream.status === 'live' && stream.viewerCount
        ? `, ${stream.viewerCount} viewers`
        : ''
    }`;

    return (
      <article
        className={cn(
          'group relative',
          'rounded-lg overflow-hidden',
          'bg-white dark:bg-gray-900',
          'border border-gray-200 dark:border-gray-700',
          'shadow-md hover:shadow-lg',
          'transition-all duration-200',
          'cursor-pointer',
          'hover:scale-[1.02] active:scale-[0.98]',
          variant === 'compact' && 'shadow-sm hover:shadow-md',
          variant === 'featured' && 'shadow-lg hover:shadow-xl ring-2 ring-primary',
          className
        )}
        onClick={handleClick}
        onKeyDown={handleKeyPress}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
      >
        {/* Thumbnail Container (16:9 aspect ratio) */}
        <div className="relative aspect-video bg-gray-200 dark:bg-gray-800 overflow-hidden">
          {/* Placeholder gradient (shown while loading) */}
          {!imageLoaded && !imageError && (
            <div className="absolute inset-0 bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-700 dark:to-gray-800 animate-pulse" />
          )}

          {/* Actual thumbnail image */}
          {!imageError && (
            <Image
              src={stream.thumbnailUrl}
              alt={stream.title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className={cn(
                'object-cover transition-opacity duration-300',
                imageLoaded ? 'opacity-100' : 'opacity-0'
              )}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
              loading={priority ? 'eager' : 'lazy'}
              priority={priority}
            />
          )}

          {/* Error state */}
          {imageError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-300 dark:bg-gray-700">
              <div className="text-center">
                <ImageOff className="w-12 h-12 md:w-16 md:h-16 text-gray-500 mx-auto mb-2" />
                <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">
                  Failed to load thumbnail
                </p>
              </div>
            </div>
          )}

          {/* Status Badge (top-left overlay) */}
          <div className="absolute top-2 left-2 z-10">
            <StreamStatusBadge
              status={stream.status}
              scheduledTime={stream.scheduledStartTime}
              endedTime={stream.endedAt}
            />
          </div>

          {/* Viewer Count (top-right overlay) */}
          {stream.status === 'live' && showViewers && stream.viewerCount !== undefined && (
            <div className="absolute top-2 right-2 z-10">
              <ViewerCount count={stream.viewerCount} isLive />
            </div>
          )}

          {/* Play Button Overlay (shown on hover) */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/30">
            <button
              className="rounded-full bg-white/90 p-3 md:p-4 hover:bg-white transform hover:scale-110 transition-transform duration-200"
              aria-label="Play stream"
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
            >
              <Play className="w-5 h-5 md:w-6 md:h-6 text-primary fill-primary" />
            </button>
          </div>
        </div>

        {/* Content Section */}
        <div className="p-3 md:p-4 space-y-2">
          {/* Stream Title */}
          <h3
            className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight"
            title={stream.title}
          >
            {stream.title}
          </h3>

          {/* Channel Info */}
          {showChannel && (
            <div className="flex items-center gap-2">
              {stream.channel.avatarUrl && (
                <div className="relative w-6 h-6 md:w-8 md:h-8 flex-shrink-0">
                  <Image
                    src={stream.channel.avatarUrl}
                    alt={stream.channel.name}
                    fill
                    className="rounded-full object-cover"
                    sizes="32px"
                  />
                </div>
              )}
              <span className="text-xs md:text-sm text-gray-600 dark:text-gray-400 truncate">
                {stream.channel.name}
              </span>
            </div>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-1.5 text-[10px] md:text-xs text-gray-500 dark:text-gray-500">
            {stream.category && (
              <>
                <span className="truncate">{stream.category}</span>
                {relativeTime && <span aria-hidden="true">•</span>}
              </>
            )}
            {relativeTime && <span className="truncate">{relativeTime}</span>}
          </div>
        </div>
      </article>
    );
  }
);

LiveStreamCard.displayName = 'LiveStreamCard';

// Export sub-components
export { LiveStreamCardSkeleton } from './Skeleton';
export type { LiveStreamCardProps, LiveStreamCardSkeletonProps } from './types';

export default LiveStreamCard;
