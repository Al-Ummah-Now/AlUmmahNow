/**
 * LivePageClient - Client Component
 * Task 1.6: /en/live Page with Grid Layout and Filters
 *
 * Client component that handles:
 * - Data fetching with React Query
 * - Responsive grid layout
 * - Loading and error states
 * - Empty state messaging
 * - Future: Tab navigation and filters
 */

'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveStreams } from '@/hooks/useLiveStreams';
import { useLanguage } from '@/hooks/useLanguage';
import { LiveStreamCard, LiveStreamCardSkeleton } from '@/components/live-streaming/LiveStreamCard';
import { AlertCircle, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger-client';

/**
 * Grid layout component for live stream cards
 */
function StreamGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid gap-4 sm:gap-6',
        'grid-cols-1',
        'sm:grid-cols-2',
        'lg:grid-cols-3',
        'xl:grid-cols-4',
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Loading skeleton grid
 */
function LoadingSkeleton({ count = 12 }: { count?: number }) {
  return (
    <StreamGrid>
      {Array.from({ length: count }, (_, i) => (
        <LiveStreamCardSkeleton key={i} />
      ))}
    </StreamGrid>
  );
}

/**
 * Error state component
 */
function ErrorState({
  error,
  onRetry,
  t
}: {
  error: Error | null;
  onRetry: () => void;
  t: ReturnType<typeof useLanguage>['t'];
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="rounded-full bg-red-100 dark:bg-red-900/20 p-4 mb-4">
        <AlertCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        {t.live?.failedToLoadStreams || 'Failed to Load Streams'}
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md">
        {error?.message || t.live?.failedToLoadStreamsDescription || 'An error occurred while loading live streams. Please try again.'}
      </p>
      <button
        onClick={onRetry}
        className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium"
      >
        {t.live?.tryAgain || 'Try Again'}
      </button>
    </div>
  );
}

/**
 * Empty state component
 */
function EmptyState({ t }: { t: ReturnType<typeof useLanguage>['t'] }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="rounded-full bg-gray-100 dark:bg-gray-800 p-4 mb-4">
        <Radio className="w-12 h-12 text-gray-400 dark:text-gray-600" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        {t.live?.noLiveStreams || 'No Live Streams'}
      </h2>
      <p className="text-gray-600 dark:text-gray-400 max-w-md">
        {t.live?.noLiveStreamsDescription || 'There are no live streams at the moment. Check back later or explore scheduled streams.'}
      </p>
    </div>
  );
}

/**
 * Page header component
 */
function PageHeader({ t }: { t: ReturnType<typeof useLanguage>['t'] }) {
  return (
    <div className="mb-6 md:mb-8">
      <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2">
        {t.live?.liveStreams || 'Live Streams'}
      </h1>
      <p className="text-gray-600 dark:text-gray-400 text-sm md:text-base">
        {t.live?.liveStreamsDescription || 'Watch live Islamic lectures, discussions, and educational content'}
      </p>
    </div>
  );
}

/**
 * Format stream count with proper pluralization
 */
function formatStreamCount(count: number, t: ReturnType<typeof useLanguage>['t']): string {
  const baseText = t.live?.showingStreamsCount || 'Showing {count} live stream';
  const text = baseText.replace('{count}', count.toString());
  // Add 's' for plural in English
  return count !== 1 ? text + 's' : text;
}

/**
 * LivePageClient Component
 *
 * Main client component that fetches and displays live streams in a responsive grid.
 * Features comprehensive error handling, loading states, and empty states.
 */
export function LivePageClient() {
  const router = useRouter();
  const { t } = useLanguage();

  // Fetch live streams with automatic refetching every 30 seconds
  const {
    streams,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useLiveStreams({
    status: 'live',
    limit: 12,
    refetchInterval: 30000, // 30 seconds
  });

  // Log stream count for debugging
  useEffect(() => {
    logger.debug('[LivePage] Loaded live streams', { count: streams.length });
  }, [streams.length]);

  // Handle card click - navigate to stream page
  const handleStreamClick = (streamId: string) => {
    logger.debug('[LivePage] Navigating to stream', { streamId });
    router.push(`/en/live/${streamId}`);
  };

  return (
    <main className="flex-1 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6 md:py-8 max-w-7xl">
        <PageHeader t={t} />

        {/* Loading State */}
        {isLoading && (
          <div>
            <LoadingSkeleton count={12} />
          </div>
        )}

        {/* Error State */}
        {isError && !isLoading && (
          <ErrorState error={error} onRetry={() => refetch()} t={t} />
        )}

        {/* Empty State */}
        {!isLoading && !isError && streams.length === 0 && (
          <EmptyState t={t} />
        )}

        {/* Stream Grid */}
        {!isLoading && !isError && streams.length > 0 && (
          <>
            {/* Refetching indicator */}
            {isFetching && !isLoading && (
              <div className="mb-4 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span>{t.live?.updatingLiveStreams || 'Updating live streams...'}</span>
              </div>
            )}

            <StreamGrid>
              {streams.map((stream, index) => (
                <LiveStreamCard
                  key={stream.id}
                  stream={stream}
                  onPlay={() => handleStreamClick(stream.id)}
                  priority={index < 4} // Prioritize first 4 images for LCP
                />
              ))}
            </StreamGrid>

            {/* Stream count */}
            <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {formatStreamCount(streams.length, t)}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
