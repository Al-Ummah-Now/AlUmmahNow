/**
 * StreamStatusBadge Component (RTL)
 * Task 1.1: Stream Status Badge Component - RTL Variant
 *
 * Arabic/RTL version with reversed flex direction and proper text alignment.
 */

'use client';

import React from 'react';
import { Circle, Clock, CheckCircle, CircleOff, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { badgeVariants, iconSizeClasses } from '../variants';
import type { StreamStatusBadgeProps, StreamStatus } from '../types';

/**
 * Icon mapping for each stream status
 */
const STATUS_ICONS: Record<StreamStatus, LucideIcon> = {
  live: Circle,
  scheduled: Clock,
  ended: CheckCircle,
  offline: CircleOff,
};

/**
 * Label mapping for each stream status (Arabic)
 */
const STATUS_LABELS: Record<StreamStatus, string> = {
  live: 'مباشر',
  scheduled: 'مجدول',
  ended: 'انتهى',
  offline: 'غير متصل',
};

/**
 * ARIA label mapping for accessibility (Arabic)
 */
const STATUS_ARIA_LABELS: Record<StreamStatus, string> = {
  live: 'البث مباشر حاليًا',
  scheduled: 'البث مجدول',
  ended: 'انتهى البث',
  offline: 'البث غير متصل',
};

/**
 * StreamStatusBadge RTL Component
 *
 * RTL variant with Arabic labels and reversed flex direction.
 *
 * @example
 * ```tsx
 * <StreamStatusBadgeRTL status="live" showIcon size="md" />
 * <StreamStatusBadgeRTL status="scheduled" scheduledTime={new Date('2024-01-01')} />
 * ```
 */
export const StreamStatusBadgeRTL = React.memo<StreamStatusBadgeProps>(
  ({
    status = 'offline',
    size = 'md',
    showIcon = true,
    className,
    scheduledTime,
    endedTime,
  }) => {
    // Ensure status is valid
    const safeStatus: StreamStatus = ['live', 'scheduled', 'ended', 'offline'].includes(
      status as string
    )
      ? (status as StreamStatus)
      : 'offline';

    const Icon = STATUS_ICONS[safeStatus];
    const label = STATUS_LABELS[safeStatus];
    const ariaLabel = STATUS_ARIA_LABELS[safeStatus];

    return (
      <div
        role="status"
        aria-label={`حالة البث: ${ariaLabel}`}
        dir="rtl"
        className={cn(
          badgeVariants({ status: safeStatus, size }),
          'flex-row-reverse', // RTL: Reverse icon and text
          className
        )}
      >
        {showIcon && <Icon className={iconSizeClasses[size || 'md']} aria-hidden="true" />}
        <span>{label}</span>

        {/* Screen reader only - additional context */}
        <span className="sr-only">
          {safeStatus === 'scheduled' && scheduledTime && (
            ` - مجدول في ${scheduledTime.toLocaleString('ar-SA')}`
          )}
          {safeStatus === 'ended' && endedTime && (
            ` - انتهى في ${endedTime.toLocaleString('ar-SA')}`
          )}
        </span>
      </div>
    );
  }
);

StreamStatusBadgeRTL.displayName = 'StreamStatusBadgeRTL';

export default StreamStatusBadgeRTL;
