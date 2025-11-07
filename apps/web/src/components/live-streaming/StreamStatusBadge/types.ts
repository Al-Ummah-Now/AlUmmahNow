/**
 * StreamStatusBadge Component Types
 * Task 1.1: Stream Status Badge Component
 */

import { VariantProps } from 'class-variance-authority';
import { badgeVariants } from './variants';

/**
 * Valid stream status values
 * As per Task 1.1 specification
 */
export type StreamStatus = 'live' | 'scheduled' | 'ended' | 'offline';

/**
 * Badge size variants
 */
export type BadgeSize = 'sm' | 'md' | 'lg';

/**
 * StreamStatusBadge component props
 */
export interface StreamStatusBadgeProps
  extends VariantProps<typeof badgeVariants> {
  /**
   * Current stream status
   * @default 'offline'
   */
  status?: StreamStatus;

  /**
   * Badge size variant
   * @default 'md'
   */
  size?: BadgeSize;

  /**
   * Whether to show the status icon
   * @default true
   */
  showIcon?: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Scheduled start time (for tooltip)
   */
  scheduledTime?: Date;

  /**
   * Ended time (for tooltip)
   */
  endedTime?: Date;
}
