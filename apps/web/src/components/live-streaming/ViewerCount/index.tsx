/**
 * ViewerCount Component (LTR)
 * Task 1.2: ViewerCount Component
 *
 * A reusable component that displays the current viewer count for a live stream
 * with proper formatting, localization, and responsive behavior.
 */

'use client';

import React, { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatViewerCountEnglish, getViewerCountLabel } from '@/lib/utils/number-format';
import {
  getContainerClasses,
  getIconClasses,
  labelClasses,
  numberClasses,
} from './variants';
import type { ViewerCountProps } from './types';

/**
 * ViewerCount Component
 *
 * Displays a visual indicator of the current number of viewers watching a stream.
 * Includes an eye icon, formatted viewer count, and optional "watching" label.
 *
 * Features:
 * - Compact (1.2K) and full (1,234) number formatting
 * - Responsive: compact on mobile, full on tablet+
 * - Live indicator styling with red color
 * - Optional click handler for refresh functionality
 * - Loading state support
 * - WCAG 2.1 AA compliant with proper ARIA labels
 *
 * @example
 * ```tsx
 * // Basic usage
 * <ViewerCount count={1234} isLive />
 *
 * // With label on desktop
 * <ViewerCount count={5678} isLive showLabel />
 *
 * // Full format with click handler
 * <ViewerCount
 *   count={10000}
 *   format="full"
 *   onClick={() => refetchViewerCount()}
 * />
 *
 * // Loading state
 * <ViewerCount count={0} isLoading />
 * ```
 */
export const ViewerCount = React.memo<ViewerCountProps>(
  ({
    count,
    isLive = false,
    showLabel = false,
    format = 'compact',
    className,
    onClick,
    isLoading = false,
  }) => {
    // Validate and sanitize the count
    const safeCount = Math.max(0, Number(count) || 0);

    // Memoize the formatted count to avoid recreating on every render
    const formattedCount = useMemo(
      () => (isLoading ? '—' : formatViewerCountEnglish(safeCount, format)),
      [safeCount, format, isLoading]
    );

    // Generate accessible label for screen readers
    const ariaLabel = useMemo(
      () => (isLoading ? 'Loading viewer count' : getViewerCountLabel(safeCount, 'en-US')),
      [safeCount, isLoading]
    );

    return (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={ariaLabel}
        className={cn(getContainerClasses(isLive, !!onClick), className)}
        onClick={onClick}
      >
        {/* Eye icon with live state styling */}
        <Eye
          className={cn(getIconClasses(isLive), isLoading && 'animate-pulse')}
          aria-hidden="true"
        />

        {/* Formatted viewer count */}
        <span className={numberClasses}>{formattedCount}</span>

        {/* Optional "watching" label (hidden on mobile) */}
        {showLabel && !isLoading && <span className={labelClasses}>watching</span>}
      </div>
    );
  }
);

ViewerCount.displayName = 'ViewerCount';

export default ViewerCount;
