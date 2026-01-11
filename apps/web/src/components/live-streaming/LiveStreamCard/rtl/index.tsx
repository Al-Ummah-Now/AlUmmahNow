/**
 * LiveStreamCard Component (RTL)
 * Task 1.4: LiveStreamCard RTL Variant (Arabic)
 *
 * Right-to-left mirrored version of LiveStreamCard with Arabic text support,
 * reversed layouts, and proper RTL positioning while maintaining identical
 * functionality to the LTR version.
 */

'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { Play, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StreamStatusBadge } from '../../StreamStatusBadge';
import { ViewerCountRTL } from '../../ViewerCount/rtl';
import { formatViewerCountArabic } from '@/lib/utils/number-format';
import type { LiveStreamCardProps } from '../types';

/**
 * Format relative time from date (Arabic)
 * Examples: "منذ ساعتين", "بدأ منذ 30 دقيقة"
 */
function formatRelativeTimeArabic(date: Date | undefined, prefix: string = ''): string | null {
  if (!date) return null;

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  // Format numbers in Arabic numerals
  const formatNum = (n: number) => new Intl.NumberFormat('ar-SA').format(n);

  if (days > 0) {
    return `${prefix}منذ ${formatNum(days)} ${days === 1 ? 'يوم' : 'أيام'}`;
  }
  if (hours > 0) {
    return `${prefix}منذ ${formatNum(hours)} ${hours === 1 ? 'ساعة' : hours === 2 ? 'ساعتين' : 'ساعات'}`;
  }
  if (minutes > 0) {
    return `${prefix}منذ ${formatNum(minutes)} ${minutes === 1 ? 'دقيقة' : minutes === 2 ? 'دقيقتين' : 'دقائق'}`;
  }
  return `${prefix}الآن`;
}

/**
 * LiveStreamCard RTL Component
 *
 * Displays a preview card for a live stream with RTL layout, Arabic text,
 * and mirrored positioning for all elements.
 *
 * RTL-Specific Features:
 * - Status badge positioned top-RIGHT (opposite of LTR)
 * - Viewer count positioned top-LEFT (opposite of LTR)
 * - Channel info with avatar on left, name on right (flex-row-reverse)
 * - All text right-aligned
 * - Metadata flows right-to-left
 * - Arabic numerals and date formatting
 * - dir="rtl" attribute for proper text direction
 *
 * Unchanged from LTR:
 * - 16:9 aspect ratio
 * - Play button centered
 * - Image loading states
 * - Dark mode support
 * - Mobile-first responsive design
 * - Accessibility features
 * - All business logic
 *
 * @example
 * ```tsx
 * <LiveStreamCardRTL
 *   stream={liveStream}
 *   onPlay={() => router.push(`/ar/live/${stream.id}`)}
 *   priority={index < 4}
 * />
 * ```
 */
export const LiveStreamCardRTL = React.memo<LiveStreamCardProps>(
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

    // Memoize formatted values with Arabic locale
    const relativeTime = useMemo(() => {
      if (stream.status === 'live' && stream.startedAt) {
        return formatRelativeTimeArabic(stream.startedAt, 'بدأ ');
      }
      if (stream.status === 'scheduled' && stream.scheduledStartTime) {
        const now = new Date();
        const scheduled = stream.scheduledStartTime;
        if (scheduled > now) {
          const diff = scheduled.getTime() - now.getTime();
          const hours = Math.floor(diff / (1000 * 60 * 60));
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          const formatNum = (n: number) => new Intl.NumberFormat('ar-SA').format(n);
          if (hours > 0) {
            return `يبدأ بعد ${formatNum(hours)} ${hours === 1 ? 'ساعة' : hours === 2 ? 'ساعتين' : 'ساعات'} و ${formatNum(minutes)} ${minutes === 1 ? 'دقيقة' : minutes === 2 ? 'دقيقتين' : 'دقائق'}`;
          }
          return `يبدأ بعد ${formatNum(minutes)} ${minutes === 1 ? 'دقيقة' : minutes === 2 ? 'دقيقتين' : 'دقائق'}`;
        }
      }
      if (stream.status === 'ended' && stream.endedAt) {
        return formatRelativeTimeArabic(stream.endedAt, 'انتهى ');
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

    // Arabic aria label
    const ariaLabel = useMemo(() => {
      const viewerText =
        stream.status === 'live' && stream.viewerCount
          ? `، ${formatViewerCountArabic(stream.viewerCount, 'full')} مشاهد`
          : '';
      return `بث مباشر: ${stream.title} بواسطة ${stream.channel.name}${viewerText}`;
    }, [stream.title, stream.channel.name, stream.status, stream.viewerCount]);

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
        dir="rtl"
        lang="ar"
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
                  فشل تحميل الصورة
                </p>
              </div>
            </div>
          )}

          {/* RTL: Status Badge (top-RIGHT, opposite of LTR top-left) */}
          <div className="absolute top-2 right-2 z-10">
            <StreamStatusBadge
              status={stream.status}
              scheduledTime={stream.scheduledStartTime}
              endedTime={stream.endedAt}
            />
          </div>

          {/* RTL: Viewer Count (top-LEFT, opposite of LTR top-right) */}
          {stream.status === 'live' && showViewers && stream.viewerCount !== undefined && (
            <div className="absolute top-2 left-2 z-10">
              <ViewerCountRTL count={stream.viewerCount} isLive />
            </div>
          )}

          {/* Play Button Overlay (shown on hover) - CENTERED, no RTL change */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/30">
            <button
              className="rounded-full bg-white/90 p-3 md:p-4 hover:bg-white transform hover:scale-110 transition-transform duration-200"
              aria-label="تشغيل البث"
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
            >
              <Play className="w-5 h-5 md:w-6 md:h-6 text-primary fill-primary" />
            </button>
          </div>
        </div>

        {/* Content Section - RTL Layout */}
        <div className="p-3 md:p-4 space-y-2">
          {/* Stream Title - Right-aligned for RTL */}
          <h3
            className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white line-clamp-2 leading-tight text-right"
            title={stream.title}
          >
            {stream.title}
          </h3>

          {/* Channel Info - RTL: flex-row-reverse (avatar left, name right) */}
          {showChannel && (
            <div className="flex flex-row-reverse items-center gap-2">
              <span className="text-xs md:text-sm text-gray-600 dark:text-gray-400 truncate text-right">
                {stream.channel.name}
              </span>
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
            </div>
          )}

          {/* Metadata - RTL: flex-row-reverse (right-to-left flow) */}
          <div className="flex flex-row-reverse items-center gap-1.5 text-[10px] md:text-xs text-gray-500 dark:text-gray-500 justify-end">
            {relativeTime && <span className="truncate">{relativeTime}</span>}
            {stream.category && relativeTime && <span aria-hidden="true">•</span>}
            {stream.category && (
              <>
                <span className="truncate">{stream.category}</span>
              </>
            )}
          </div>
        </div>
      </article>
    );
  }
);

LiveStreamCardRTL.displayName = 'LiveStreamCardRTL';

export default LiveStreamCardRTL;
