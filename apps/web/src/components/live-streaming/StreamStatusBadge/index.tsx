/**
 * StreamStatusBadge Component (LTR)
 * Task 1.1: Stream Status Badge Component
 *
 * A reusable badge component that displays the current status of a live stream
 * with appropriate visual indicators and animations.
 */

'use client';

import React from 'react';
import { Circle, Clock, CheckCircle, CircleOff, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { badgeVariants, iconSizeClasses } from './variants';
import type { StreamStatusBadgeProps, StreamStatus } from './types';

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
 * Label mapping for each stream status
 */
const STATUS_LABELS: Record<StreamStatus, string> = {
  live: 'LIVE',
  scheduled: 'SCHEDULED',
  ended: 'ENDED',
  offline: 'OFFLINE',
};

/**
 * ARIA label mapping for accessibility
 */
const STATUS_ARIA_LABELS: Record<StreamStatus, string> = {
  live: 'Stream is currently live',
  scheduled: 'Stream is scheduled',
  ended: 'Stream has ended',
  offline: 'Stream is offline',
};

/**
 * StreamStatusBadge Component
 *
 * Displays a visual badge indicating the current status of a live stream.
 * Includes status-specific icons, colors, and animations (e.g., pulse for live status).
 *
 * @example
 * ```tsx
 * <StreamStatusBadge status="live" showIcon size="md" />
 * <StreamStatusBadge status="scheduled" scheduledTime={new Date('2024-01-01')} />
 * ```
 */
export const StreamStatusBadge = React.memo<StreamStatusBadgeProps>(
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
        aria-label={`Stream status: ${ariaLabel}`}
        className={cn(badgeVariants({ status: safeStatus, size }), className)}
      >
        {showIcon && <Icon className={iconSizeClasses[size || 'md']} aria-hidden="true" />}
        <span>{label}</span>

        {/* Screen reader only - additional context */}
        <span className="sr-only">
          {safeStatus === 'scheduled' && scheduledTime && (
            ` - Scheduled for ${scheduledTime.toLocaleString('en-US')}`
          )}
          {safeStatus === 'ended' && endedTime && (
            ` - Ended at ${endedTime.toLocaleString('en-US')}`
          )}
        </span>
      </div>
    );
  }
);

StreamStatusBadge.displayName = 'StreamStatusBadge';

export default StreamStatusBadge;
