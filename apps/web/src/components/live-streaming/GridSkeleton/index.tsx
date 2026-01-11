/**
 * GridSkeleton Component
 * Task 1.10: Loading Skeletons for Cards
 *
 * Displays a grid of skeleton cards for loading states
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { LiveStreamCardSkeleton } from '../LiveStreamCard/Skeleton';

/**
 * Props for the GridSkeleton component
 */
export interface GridSkeletonProps {
  /**
   * Number of skeleton cards to display
   * @default 12
   */
  count?: number;

  /**
   * Variant to pass to skeleton cards
   * @default 'default'
   */
  variant?: 'default' | 'compact' | 'featured';

  /**
   * Optional CSS class name
   */
  className?: string;
}

/**
 * GridSkeleton Component
 *
 * Renders a grid of LiveStreamCardSkeleton components for loading states.
 * Matches the layout of the actual stream grid for a seamless loading experience.
 *
 * Features:
 * - Responsive grid layout (1-4 columns)
 * - Configurable number of skeletons
 * - Staggered fade-in animation
 * - Dark mode support
 * - Accessible with aria-busy attribute
 *
 * @example
 * ```tsx
 * {isLoading && <GridSkeleton count={8} />}
 * ```
 */
export const GridSkeleton = React.memo<GridSkeletonProps>(
  ({ count = 12, variant = 'default', className }) => {
    return (
      <div
        className={cn(
          'grid gap-4',
          'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
          className
        )}
        role="status"
        aria-busy="true"
        aria-label="Loading stream cards"
      >
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className="animate-fadeIn"
            style={{
              animationDelay: `${index * 50}ms`,
              animationFillMode: 'backwards'
            }}
          >
            <LiveStreamCardSkeleton variant={variant} />
          </div>
        ))}
        <span className="sr-only">Loading {count} stream cards</span>
      </div>
    );
  }
);

GridSkeleton.displayName = 'GridSkeleton';

export default GridSkeleton;
