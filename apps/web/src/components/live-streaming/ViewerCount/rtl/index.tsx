/**
 * ViewerCount Component (RTL)
 * Task 1.2: ViewerCount Component - RTL Variant
 *
 * Arabic/RTL version with reversed flex direction, Arabic numerals,
 * and proper text alignment.
 */

'use client';

import React, { useMemo } from 'react';
import { Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatViewerCountArabic, getViewerCountLabel } from '@/lib/utils/number-format';
import {
  getContainerClasses,
  getIconClasses,
  labelClasses,
  numberClasses,
} from '../variants';
import type { ViewerCountProps } from '../types';

/**
 * ViewerCount RTL Component
 *
 * RTL variant with Arabic numerals and labels, reversed flex direction.
 *
 * Features:
 * - Eastern Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩)
 * - Compact (١٫٢ ألف) and full (١٬٢٣٤) formatting
 * - Reversed layout (icon on right)
 * - Arabic "يشاهدون" label
 * - Same accessibility and performance as LTR variant
 *
 * @example
 * ```tsx
 * // Basic usage
 * <ViewerCountRTL count={1234} isLive />
 *
 * // With Arabic label
 * <ViewerCountRTL count={5678} isLive showLabel />
 *
 * // Full format
 * <ViewerCountRTL count={10000} format="full" />
 * ```
 */
export const ViewerCountRTL = React.memo<ViewerCountProps>(
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

    // Memoize the formatted count with Arabic numerals
    const formattedCount = useMemo(
      () => (isLoading ? '—' : formatViewerCountArabic(safeCount, format)),
      [safeCount, format, isLoading]
    );

    // Generate accessible label for screen readers in Arabic
    const ariaLabel = useMemo(
      () => (isLoading ? 'جارٍ تحميل عدد المشاهدين' : getViewerCountLabel(safeCount, 'ar-SA')),
      [safeCount, isLoading]
    );

    return (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={ariaLabel}
        dir="rtl"
        className={cn(
          getContainerClasses(isLive, !!onClick),
          'flex-row-reverse', // RTL: Icon on right, text on left
          className
        )}
        onClick={onClick}
      >
        {/* Eye icon with live state styling */}
        <Eye
          className={cn(getIconClasses(isLive), isLoading && 'animate-pulse')}
          aria-hidden="true"
        />

        {/* Formatted viewer count with Arabic numerals */}
        <span className={numberClasses}>{formattedCount}</span>

        {/* Optional "يشاهدون" label (hidden on mobile) */}
        {showLabel && !isLoading && <span className={labelClasses}>يشاهدون</span>}
      </div>
    );
  }
);

ViewerCountRTL.displayName = 'ViewerCountRTL';

export default ViewerCountRTL;
