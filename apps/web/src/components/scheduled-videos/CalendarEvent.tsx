/**
 * CalendarEvent Component
 * Outlook-style calendar event - simple bar display, rich card on hover
 */

'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FitImage } from '@/components/VideoThumbnail/FitImage';
import { formatScheduledTime } from '@/utils/dateFormatters';
import { Clock, Play, AlertCircle, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import type { ScheduledPublishStatus } from '@al-ummah/shared-types';

export interface CalendarEventProps {
  id: string;
  title: string;
  thumbnailUrl?: string;
  scheduledDate: Date;
  status?: ScheduledPublishStatus;
  onClick?: (id: string) => void;
  locale?: 'en' | 'ar';
  className?: string;
}

// Status configuration for colors and icons
const statusConfig: Record<ScheduledPublishStatus, {
  color: string;
  bgColor: string;
  borderColor: string;
  hoverBg: string;
  icon: React.ElementType;
  label: string;
  labelAr: string;
}> = {
  scheduled: {
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/30',
    borderColor: 'border-l-blue-500',
    hoverBg: 'hover:bg-blue-100 dark:hover:bg-blue-900/50',
    icon: Clock,
    label: 'Scheduled',
    labelAr: 'مجدول'
  },
  publishing: {
    color: 'text-brand-ink dark:text-brand-ink',
    bgColor: 'bg-brand-soft dark:bg-brand-soft',
    borderColor: 'border-l-brand-edge',
    hoverBg: 'hover:bg-brand-soft dark:hover:bg-brand-soft',
    icon: Loader2,
    label: 'Publishing',
    labelAr: 'جاري النشر'
  },
  published: {
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/30',
    borderColor: 'border-l-green-500',
    hoverBg: 'hover:bg-green-100 dark:hover:bg-green-900/50',
    icon: CheckCircle,
    label: 'Published',
    labelAr: 'تم النشر'
  },
  failed: {
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-900/30',
    borderColor: 'border-l-red-500',
    hoverBg: 'hover:bg-red-100 dark:hover:bg-red-900/50',
    icon: AlertCircle,
    label: 'Failed',
    labelAr: 'فشل'
  },
  cancelled: {
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-50 dark:bg-gray-800/50',
    borderColor: 'border-l-gray-500',
    hoverBg: 'hover:bg-gray-100 dark:hover:bg-gray-700/50',
    icon: XCircle,
    label: 'Cancelled',
    labelAr: 'ملغي'
  },
};

// Format countdown display
function formatCountdown(ms: number, locale: 'en' | 'ar'): string {
  if (ms <= 0) return locale === 'ar' ? 'قريباً' : 'Soon';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const h = hours % 24;
    return locale === 'ar'
      ? `${days} يوم ${h > 0 ? `و ${h} ساعة` : ''}`
      : `${days}d ${h > 0 ? `${h}h` : ''}`;
  }
  if (hours > 0) {
    const m = minutes % 60;
    return locale === 'ar'
      ? `${hours} ساعة ${m > 0 ? `و ${m} دقيقة` : ''}`
      : `${hours}h ${m > 0 ? `${m}m` : ''}`;
  }
  if (minutes > 0) {
    return locale === 'ar' ? `${minutes} دقيقة` : `${minutes}m`;
  }
  return locale === 'ar' ? 'أقل من دقيقة' : '<1m';
}

// Format time for display (e.g., "11:10 PM")
function formatTime(date: Date, locale: 'en' | 'ar'): string {
  return date.toLocaleTimeString(locale === 'ar' ? 'ar-SA' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

export function CalendarEvent({
  id,
  title,
  thumbnailUrl,
  scheduledDate,
  status = 'scheduled',
  onClick,
  locale = 'en',
  className = '',
}: CalendarEventProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [countdown, setCountdown] = useState<string>('');
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<'above' | 'below'>('above');
  const [tooltipCoords, setTooltipCoords] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate and update countdown
  useEffect(() => {
    if (status !== 'scheduled') {
      setCountdown('');
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const scheduled = scheduledDate.getTime();
      const diff = scheduled - now;
      setCountdown(formatCountdown(diff, locale));
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000);

    return () => clearInterval(interval);
  }, [scheduledDate, status, locale]);

  const handleClick = async () => {
    if (onClick) {
      setIsLoading(true);
      try {
        await onClick(id);
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Calculate tooltip position based on available space
  const handleMouseEnter = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const tooltipHeight = 280; // Approximate tooltip height (thumbnail 144px + content ~136px)
      const tooltipWidth = 280;
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;

      // Calculate x position (centered on element, but clamped to viewport)
      let x = rect.left + rect.width / 2 - tooltipWidth / 2;
      x = Math.max(8, Math.min(x, window.innerWidth - tooltipWidth - 8));

      // Calculate y position
      let y: number;
      if (spaceAbove < tooltipHeight && spaceBelow > spaceAbove) {
        // Show below
        setTooltipPosition('below');
        y = rect.bottom + 8;
      } else {
        // Show above
        setTooltipPosition('above');
        y = rect.top - tooltipHeight - 8;
      }

      setTooltipCoords({ x, y });
    }
    setShowTooltip(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setShowTooltip(false);
  }, []);

  const scheduledTime = formatScheduledTime(scheduledDate, locale);
  const shortTime = formatTime(scheduledDate, locale);
  const statusInfo = statusConfig[status] || statusConfig.scheduled;
  const StatusIcon = statusInfo.icon;

  // Rich tooltip card content (shown on hover)
  const tooltipContent = useMemo(() => (
    <div
      className="fixed z-[9999] bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden pointer-events-none"
      style={{
        width: '280px',
        left: `${tooltipCoords.x}px`,
        top: `${tooltipCoords.y}px`,
      }}
    >
      {/* Thumbnail */}
      {thumbnailUrl && !imageError ? (
        <div className="relative w-full h-36 overflow-hidden">
          <FitImage
            src={thumbnailUrl}
            alt={title}
            onError={() => setImageError(true)}
            sizes="280px"
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* Status badge on thumbnail */}
          <div className={`absolute top-2 left-2 px-2 py-0.5 rounded text-xs font-medium ${statusInfo.bgColor} ${statusInfo.color}`}>
            <span className="flex items-center gap-1">
              <StatusIcon size={12} className={status === 'publishing' ? 'animate-spin' : ''} />
              {locale === 'ar' ? statusInfo.labelAr : statusInfo.label}
            </span>
          </div>

          {/* Countdown badge */}
          {countdown && status === 'scheduled' && (
            <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 text-white text-xs font-medium rounded flex items-center gap-1">
              <Clock size={12} />
              {countdown}
            </div>
          )}
        </div>
      ) : (
        <div className="w-full h-36 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center">
          <Play className="w-12 h-12 text-gray-400 dark:text-gray-500" />
        </div>
      )}

      {/* Content */}
      <div className="p-3">
        {/* Title */}
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm leading-tight line-clamp-2 mb-2">
          {title}
        </h3>

        {/* Schedule info */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
            <Clock size={14} className="flex-shrink-0" />
            <span className="font-medium">{shortTime}</span>
            <span className="text-gray-400 dark:text-gray-500">•</span>
            <span>{scheduledTime}</span>
          </div>

          {countdown && status === 'scheduled' && (
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <Play size={14} className="flex-shrink-0" />
              <span>{locale === 'ar' ? 'ينشر خلال' : 'Publishes in'} {countdown}</span>
            </div>
          )}
        </div>
      </div>

      {/* Arrow pointing to event */}
      {tooltipPosition === 'above' ? (
        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
          <div className="border-8 border-transparent border-t-white dark:border-t-gray-800" />
        </div>
      ) : (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 -mb-px">
          <div className="border-8 border-transparent border-b-white dark:border-b-gray-800" />
        </div>
      )}
    </div>
  ), [title, thumbnailUrl, imageError, shortTime, scheduledTime, countdown, status, statusInfo, StatusIcon, locale, tooltipPosition, tooltipCoords]);

  return (
    <div
      ref={containerRef}
      className={`
        group relative h-full min-h-[24px]
        ${statusInfo.bgColor} ${statusInfo.hoverBg}
        border-l-4 ${statusInfo.borderColor}
        rounded-r transition-colors duration-150
        cursor-pointer overflow-hidden
        ${className}
      `}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="button"
      tabIndex={0}
      data-testid="calendar-event"
      data-video-id={id}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label={`Video: ${title}. Scheduled ${scheduledTime}. Status: ${statusInfo.label}`}
    >
      {/* Hover tooltip with video card */}
      {showTooltip && tooltipContent}

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-800/80 z-10">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
        </div>
      )}

      {/* Outlook-style bar content */}
      <div className="flex items-center gap-1.5 px-2 py-1 h-full">
        {/* Status icon */}
        <StatusIcon
          size={12}
          className={`flex-shrink-0 ${statusInfo.color} ${status === 'publishing' ? 'animate-spin' : ''}`}
        />

        {/* Title - truncated */}
        <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">
          {title}
        </span>

        {/* Countdown badge (only if space allows) */}
        {countdown && status === 'scheduled' && (
          <span className="hidden sm:inline-flex text-[10px] text-gray-500 dark:text-gray-400 flex-shrink-0">
            {countdown}
          </span>
        )}
      </div>
    </div>
  );
}
