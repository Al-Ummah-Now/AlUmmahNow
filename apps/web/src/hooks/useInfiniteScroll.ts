/**
 * useInfiniteScroll Hook
 * Task 1.9: Infinite Scroll Pagination
 *
 * Custom hook that uses Intersection Observer API to detect when the user
 * has scrolled near the bottom of the page and trigger loading more content.
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * Options for configuring the useInfiniteScroll hook
 */
export interface UseInfiniteScrollOptions {
  /**
   * Whether there are more items to load
   */
  hasMore: boolean;

  /**
   * Function to call when more content should be loaded
   */
  onLoadMore: () => Promise<void> | void;

  /**
   * Intersection threshold (0-1)
   * @default 0.5
   */
  threshold?: number;

  /**
   * Root margin for the intersection observer
   * Controls how far from the bottom to trigger loading
   * @default '100px'
   */
  rootMargin?: string;

  /**
   * Whether the hook is enabled
   * @default true
   */
  enabled?: boolean;

  /**
   * Debounce delay in milliseconds
   * Prevents multiple rapid calls to onLoadMore
   * @default 200
   */
  debounceDelay?: number;
}

/**
 * Custom hook for implementing infinite scroll pagination
 *
 * Uses the Intersection Observer API to detect when a trigger element
 * becomes visible in the viewport and automatically loads more content.
 *
 * Features:
 * - Automatic cleanup of observers
 * - Debouncing to prevent rapid consecutive calls
 * - Configurable threshold and root margin
 * - Can be disabled/enabled dynamically
 * - Handles edge cases (no more content, disabled state)
 *
 * @example
 * ```tsx
 * function StreamList() {
 *   const { streams, hasNextPage, fetchNextPage, isFetchingNextPage } = useLiveStreams();
 *   const triggerRef = useInfiniteScroll({
 *     hasMore: hasNextPage,
 *     onLoadMore: fetchNextPage,
 *     rootMargin: '200px'
 *   });
 *
 *   return (
 *     <>
 *       {streams.map(stream => <StreamCard key={stream.id} stream={stream} />)}
 *       <div ref={triggerRef}>
 *         {isFetchingNextPage && <Spinner />}
 *       </div>
 *     </>
 *   );
 * }
 * ```
 *
 * @param options - Configuration options for the hook
 * @returns Ref to attach to the trigger element
 */
export function useInfiniteScroll({
  hasMore,
  onLoadMore,
  threshold = 0.5,
  rootMargin = '100px',
  enabled = true,
  debounceDelay = 200
}: UseInfiniteScrollOptions) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced load more function
  const debouncedLoadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore || !enabled) {
      return;
    }

    // Clear any pending debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer
    debounceTimerRef.current = setTimeout(async () => {
      loadingRef.current = true;

      try {
        console.log('[useInfiniteScroll] Loading more content');
        await onLoadMore();
      } catch (error) {
        console.error('[useInfiniteScroll] Error loading more content:', error);
      } finally {
        loadingRef.current = false;
      }
    }, debounceDelay);
  }, [hasMore, enabled, onLoadMore, debounceDelay]);

  // Set up the intersection observer
  useEffect(() => {
    // Don't observe if disabled or no more content
    if (!enabled || !hasMore) {
      console.log('[useInfiniteScroll] Observer disabled:', { enabled, hasMore });
      return;
    }

    // Create the intersection observer
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;

        console.log('[useInfiniteScroll] Intersection observed:', {
          isIntersecting: entry.isIntersecting,
          intersectionRatio: entry.intersectionRatio
        });

        // Trigger loading when the element becomes visible
        if (entry.isIntersecting) {
          debouncedLoadMore();
        }
      },
      {
        threshold,
        rootMargin,
        root: null // Use viewport as root
      }
    );

    // Start observing the trigger element
    const currentTrigger = triggerRef.current;
    if (currentTrigger && observerRef.current) {
      console.log('[useInfiniteScroll] Starting to observe trigger element');
      observerRef.current.observe(currentTrigger);
    }

    // Cleanup function
    return () => {
      if (observerRef.current) {
        console.log('[useInfiniteScroll] Cleaning up observer');
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [enabled, hasMore, threshold, rootMargin, debouncedLoadMore]);

  return triggerRef;
}

export default useInfiniteScroll;
