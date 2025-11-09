/**
 * LivePageClientRTL - Client Component (Arabic/RTL)
 * Task 1.7: /ar/live Page with RTL Layout
 *
 * RTL client component that handles:
 * - Right-to-left layout
 * - Arabic text and translations
 * - Data fetching with React Query
 * - Responsive grid layout
 * - Loading and error states with Arabic messages
 * - Empty state messaging in Arabic
 * - Arabic numerals via ViewerCount RTL variant
 */

'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveStreams } from '@/hooks/useLiveStreams';
import { LiveStreamCardRTL } from '@/components/live-streaming/LiveStreamCard/rtl';
import { LiveStreamCardSkeleton } from '@/components/live-streaming/LiveStreamCard/Skeleton';
import { AlertCircle, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/utils/logger';

/**
 * Grid layout component for live stream cards (RTL)
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
      dir="rtl"
    >
      {children}
    </div>
  );
}

/**
 * Loading skeleton grid (RTL)
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
 * Error state component (Arabic)
 */
function ErrorState({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center" dir="rtl">
      <div className="rounded-full bg-red-100 dark:bg-red-900/20 p-4 mb-4">
        <AlertCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        فشل تحميل البثوث المباشرة
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-md">
        {error?.message || 'حدث خطأ أثناء تحميل البثوث المباشرة. يرجى المحاولة مرة أخرى.'}
      </p>
      <button
        onClick={onRetry}
        className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium"
      >
        حاول مرة أخرى
      </button>
    </div>
  );
}

/**
 * Empty state component (Arabic)
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center" dir="rtl">
      <div className="rounded-full bg-gray-100 dark:bg-gray-800 p-4 mb-4">
        <Radio className="w-12 h-12 text-gray-400 dark:text-gray-600" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        لا توجد بثوث مباشرة
      </h2>
      <p className="text-gray-600 dark:text-gray-400 max-w-md">
        لا توجد بثوث مباشرة في الوقت الحالي. تحقق لاحقًا أو استكشف البثوث المجدولة.
      </p>
    </div>
  );
}

/**
 * Page header component (Arabic/RTL)
 */
function PageHeader() {
  return (
    <div className="mb-6 md:mb-8" dir="rtl">
      <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2 text-right">
        البث المباشر
      </h1>
      <p className="text-gray-600 dark:text-gray-400 text-sm md:text-base text-right">
        شاهد المحاضرات الإسلامية المباشرة والنقاشات والمحتوى التعليمي
      </p>
    </div>
  );
}

/**
 * Format stream count in Arabic with proper pluralization
 */
function formatStreamCount(count: number): string {
  if (count === 0) return 'لا توجد بثوث';
  if (count === 1) return 'بث واحد مباشر';
  if (count === 2) return 'بثان مباشران';
  if (count <= 10) return `${new Intl.NumberFormat('ar-SA').format(count)} بثوث مباشرة`;
  return `${new Intl.NumberFormat('ar-SA').format(count)} بثًا مباشرًا`;
}

/**
 * LivePageClientRTL Component
 *
 * Main RTL client component that fetches and displays live streams in a
 * responsive grid with proper right-to-left layout and Arabic text.
 *
 * RTL-Specific Features:
 * - dir="rtl" on all containers
 * - text-right alignment
 * - Arabic translations for all UI text
 * - Arabic numerals via Intl.NumberFormat('ar-SA')
 * - RTL LiveStreamCard variant
 * - Mirrored loading indicators
 */
export function LivePageClientRTL() {
  const router = useRouter();

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
    logger.debug('[LivePageRTL] Loaded live streams', { count: streams.length });
  }, [streams.length]);

  // Handle card click - navigate to stream page (Arabic route)
  const handleStreamClick = (streamId: string) => {
    logger.debug('[LivePageRTL] Navigating to stream', { streamId });
    router.push(`/ar/live/${streamId}`);
  };

  return (
    <main className="flex-1 bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-6 md:py-8 max-w-7xl">
        <PageHeader />

        {/* Loading State */}
        {isLoading && (
          <div>
            <LoadingSkeleton count={12} />
          </div>
        )}

        {/* Error State */}
        {isError && !isLoading && (
          <ErrorState error={error} onRetry={() => refetch()} />
        )}

        {/* Empty State */}
        {!isLoading && !isError && streams.length === 0 && (
          <EmptyState />
        )}

        {/* Stream Grid */}
        {!isLoading && !isError && streams.length > 0 && (
          <>
            {/* Refetching indicator (Arabic) */}
            {isFetching && !isLoading && (
              <div className="mb-4 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400" dir="rtl">
                <span>جاري تحديث البثوث المباشرة...</span>
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            <StreamGrid>
              {streams.map((stream, index) => (
                <LiveStreamCardRTL
                  key={stream.id}
                  stream={stream}
                  onPlay={() => handleStreamClick(stream.id)}
                  priority={index < 4} // Prioritize first 4 images for LCP
                />
              ))}
            </StreamGrid>

            {/* Stream count (Arabic) */}
            <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400" dir="rtl">
              {formatStreamCount(streams.length)}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
