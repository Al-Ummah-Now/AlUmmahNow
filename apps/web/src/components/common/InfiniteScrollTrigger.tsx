/**
 * InfiniteScrollTrigger Component
 * Task 1.9: Infinite Scroll Pagination
 *
 * A trigger component that uses Intersection Observer to load more content
 * when scrolled into view. Displays loading states and end-of-results message.
 */

'use client';

import React from 'react';
import { Loader2, Check, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';

/**
 * Props for the InfiniteScrollTrigger component
 */
export interface InfiniteScrollTriggerProps {
  /**
   * Whether there are more items to load
   */
  hasMore: boolean;

  /**
   * Whether content is currently being loaded
   */
  loading: boolean;

  /**
   * Function to call when more content should be loaded
   */
  onLoadMore: () => Promise<void> | void;

  /**
   * Whether there was an error loading content
   */
  error?: boolean;

  /**
   * Function to retry loading after an error
   */
  onRetry?: () => void;

  /**
   * Custom message to show when all content is loaded
   */
  endMessage?: string;

  /**
   * Custom message to show while loading
   */
  loadingMessage?: string;

  /**
   * Custom message to show on error
   */
  errorMessage?: string;

  /**
   * Optional CSS class name
   */
  className?: string;

  /**
   * Intersection threshold (0-1)
   * @default 0.5
   */
  threshold?: number;

  /**
   * Root margin for the intersection observer
   * @default '100px'
   */
  rootMargin?: string;
}

/**
 * InfiniteScrollTrigger Component
 *
 * Displays a trigger element that automatically loads more content when
 * scrolled into view. Shows appropriate loading, error, and completion states.
 *
 * Features:
 * - Automatic loading using Intersection Observer
 * - Loading spinner with message
 * - Error state with retry button
 * - End-of-results message
 * - Manual "Load More" button as fallback
 * - Fully accessible with ARIA attributes
 * - Dark mode support
 *
 * @example
 * ```tsx
 * <InfiniteScrollTrigger
 *   hasMore={hasNextPage}
 *   loading={isFetchingNextPage}
 *   onLoadMore={fetchNextPage}
 *   error={isError}
 *   onRetry={refetch}
 * />
 * ```
 */
export const InfiniteScrollTrigger = React.memo<InfiniteScrollTriggerProps>(
  ({
    hasMore,
    loading,
    onLoadMore,
    error = false,
    onRetry,
    endMessage = "You've seen all streams",
    loadingMessage = 'Loading more streams...',
    errorMessage = 'Failed to load more streams',
    className,
    threshold = 0.5,
    rootMargin = '100px'
  }) => {
    // Set up the intersection observer
    const triggerRef = useInfiniteScroll({
      hasMore,
      onLoadMore,
      threshold,
      rootMargin,
      enabled: !loading && !error
    });

    // Don't render anything if no more content and not loading
    if (!hasMore && !loading && !error) {
      return (
        <div
          className={cn(
            'flex flex-col items-center justify-center',
            'py-8 px-4',
            'text-center',
            className
          )}
          role="status"
          aria-live="polite"
        >
          <Check
            className="w-6 h-6 text-green-500 dark:text-green-400 mb-2"
            aria-hidden="true"
          />
          <p className="text-sm md:text-base text-gray-600 dark:text-gray-400">
            {endMessage}
          </p>
        </div>
      );
    }

    // Error state
    if (error) {
      return (
        <div
          className={cn(
            'flex flex-col items-center justify-center',
            'py-8 px-4',
            'text-center',
            className
          )}
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle
            className="w-6 h-6 text-red-500 dark:text-red-400 mb-2"
            aria-hidden="true"
          />
          <p className="text-sm md:text-base text-gray-600 dark:text-gray-400 mb-4">
            {errorMessage}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className={cn(
                'px-4 py-2',
                'text-sm font-medium',
                'text-white bg-primary',
                'rounded-lg',
                'hover:bg-primary/90',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                'transition-colors duration-200'
              )}
            >
              Retry
            </button>
          )}
        </div>
      );
    }

    // Loading state or trigger element
    return (
      <div
        ref={triggerRef}
        className={cn(
          'flex flex-col items-center justify-center',
          'py-8 px-4',
          'text-center',
          className
        )}
        role="status"
        aria-live="polite"
        aria-busy={loading}
      >
        {loading ? (
          <>
            <Loader2
              className="w-6 h-6 text-primary animate-spin mb-2"
              aria-hidden="true"
            />
            <p className="text-sm md:text-base text-gray-600 dark:text-gray-400">
              {loadingMessage}
            </p>
            <span className="sr-only">Loading more content</span>
          </>
        ) : (
          // Manual load button as fallback (for accessibility)
          hasMore && (
            <button
              onClick={onLoadMore}
              className={cn(
                'px-6 py-3',
                'text-sm md:text-base font-medium',
                'text-primary border-2 border-primary',
                'rounded-lg',
                'hover:bg-primary hover:text-white',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                'transition-all duration-200',
                'min-h-[44px]' // Minimum touch target size
              )}
              aria-label="Load more streams"
            >
              Load More
            </button>
          )
        )}
      </div>
    );
  }
);

InfiniteScrollTrigger.displayName = 'InfiniteScrollTrigger';

export default InfiniteScrollTrigger;
