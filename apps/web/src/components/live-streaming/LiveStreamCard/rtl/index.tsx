/**
 * LiveStreamCard Component (RTL)
 * Task 1.4: LiveStreamCard RTL Variant (Arabic)
 *
 * Right-to-left mirrored version of LiveStreamCard with Arabic text support,
 * reversed layouts, and proper RTL positioning while maintaining identical
 * functionality to the LTR version.
 */

'use client';

import { formatCountNoun, numberFormat, pluralCategory } from '@al-ummah/shared-types';
import React, { useState, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { Play, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StreamStatusBadgeRTL } from '../../StreamStatusBadge/rtl';
import { ViewerCountRTL } from '../../ViewerCount/rtl';
import type { LiveStreamCardProps } from '../types';
import { MetaSep } from '@/components/ui/MetaSep';

/**
 * Arabic counted time after «منذ»/«بعد». Those words take the genitive, so the forms are
 * «دقيقة» (1, no numeral), «دقيقتين» (2), «٣ دقائق» (3–10, CLDR few), «١١ دقيقة» (11–99, many),
 * «١٠٠ دقيقة» (other). The notification centre's minutesAgo/hoursAgo/daysAgo use the same set.
 */
const AR_TIME_UNITS = {
  day: { one: 'يوم', two: 'يومين', few: 'أيام', many: 'يومًا', other: 'يوم' },
  hour: { one: 'ساعة', two: 'ساعتين', few: 'ساعات', many: 'ساعة', other: 'ساعة' },
  minute: { one: 'دقيقة', two: 'دقيقتين', few: 'دقائق', many: 'دقيقة', other: 'دقيقة' },
} as const;

export function arabicTimeSpan(n: number, unit: keyof typeof AR_TIME_UNITS): string {
  const forms = AR_TIME_UNITS[unit];
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const form = pluralCategory('ar', n);
  const noun = form === 'few' ? forms.few : form === 'many' ? forms.many : forms.other;
  return `${numberFormat('ar').format(n)} ${noun}`;
}

/**
 * Format relative time from date (Arabic)
 * Examples: «منذ ساعتين», «بدأ منذ ٣٠ دقيقة», «بدأ منذ دقيقة»
 */
function formatRelativeTimeArabic(date: Date | undefined, prefix: string = ''): string | null {
  if (!date) return null;

  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${prefix}منذ ${arabicTimeSpan(days, 'day')}`;
  if (hours > 0) return `${prefix}منذ ${arabicTimeSpan(hours, 'hour')}`;
  if (minutes > 0) return `${prefix}منذ ${arabicTimeSpan(minutes, 'minute')}`;
  return `${prefix}الآن`;
}

/** «يبدأ بعد ساعتين و٥ دقائق»; a whole hour drops the minutes, under a minute reads «يبدأ الآن». */
function formatStartsInArabic(diffMs: number): string {
  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours > 0) {
    return minutes > 0 ? `يبدأ بعد ${arabicTimeSpan(hours, 'hour')} و${arabicTimeSpan(minutes, 'minute')}` : `يبدأ بعد ${arabicTimeSpan(hours, 'hour')}`;
  }
  return minutes > 0 ? `يبدأ بعد ${arabicTimeSpan(minutes, 'minute')}` : 'يبدأ الآن';
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
 * - Channel info mirrored by dir="rtl": avatar on the right, then the name
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
        const diff = stream.scheduledStartTime.getTime() - Date.now();
        if (diff > 0) return formatStartsInArabic(diff);
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
          ? `، ${formatCountNoun('ar', stream.viewerCount, 'viewer')}`
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
        <div className="relative aspect-video bg-gray-200 dark:bg-black overflow-hidden">
          {/* Placeholder gradient (shown while loading) */}
          {!imageLoaded && !imageError && (
            <div className="absolute inset-0 bg-[var(--fanous-c-skeleton-bg,var(--fanous-color-surface))] animate-pulse" />
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
            <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-black">
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
            <StreamStatusBadgeRTL
              status={stream.status}
              scheduledTime={stream.scheduledStartTime}
              endedTime={stream.endedAt}
            />
          </div>

          {/* RTL: Viewer Count (top-LEFT, opposite of LTR top-right) */}
          {stream.status === 'live' && showViewers && stream.viewerCount !== undefined && (
            <div className="absolute top-2 left-2 z-10">
              <ViewerCountRTL count={stream.viewerCount} isLive className="rounded bg-[var(--fanous-c-badge-duration-bg)] px-2 py-0.5 text-[var(--fanous-c-badge-duration-text)] dark:text-[var(--fanous-c-badge-duration-text)]" />
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

          {/* Channel Info: the card is dir="rtl", so a plain row already mirrors the English card
              (avatar first, on the right, then the name); flex-row-reverse would undo it */}
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
              <span className="text-xs md:text-sm text-gray-600 dark:text-gray-400 truncate text-right">
                {stream.channel.name}
              </span>
            </div>
          )}

          {/* Metadata: a plain row in the dir="rtl" card reads right to left (time, then category) */}
          <div className="flex items-center gap-1.5 text-[10px] md:text-xs text-gray-500 dark:text-gray-500 justify-start">
            {relativeTime && <span className="truncate">{relativeTime}</span>}
            {stream.category && relativeTime && <MetaSep lang="ar" gap="0.375rem" />}
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
