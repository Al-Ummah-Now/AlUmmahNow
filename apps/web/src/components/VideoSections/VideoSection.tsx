'use client';

import React, { useState } from 'react';
import { VideoObject } from '@al-ummah/shared-types';
import { VideoGrid } from '@/components/VideoGrid';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

export interface VideoSectionProps {
  title: string | React.ReactNode;
  videos: VideoObject[];
  loading?: boolean;
  error?: string | null;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  emptyMessage?: string;
  className?: string;
  showViewAll?: boolean;
  viewAllHref?: string;
  headerActions?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Reusable video section component
 * Displays a titled section with video grid, loading states, and pagination
 */
export function VideoSection({
  title,
  videos,
  loading = false,
  error = null,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  emptyMessage,
  className = '',
  showViewAll = false,
  viewAllHref,
  headerActions,
  children,
}: VideoSectionProps) {
  const { t, isRTL } = useLanguage();
  const [expanded, setExpanded] = useState(true);

  const handleLoadMore = () => {
    if (onLoadMore && !loadingMore) {
      logger.info('[VideoSection] Loading more videos', { section: title });
      onLoadMore();
    }
  };

  return (
    <section
      className={`video-section ${className}`}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4 px-4 md:px-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
            aria-label={expanded ? t.common?.collapse : t.common?.expand}
          >
            <svg
              className={`w-5 h-5 transition-transform ${expanded ? 'rotate-0' : isRTL ? 'rotate-90' : '-rotate-90'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {typeof title === 'string' ? title : title}
          </h2>
          {!loading && videos.length > 0 && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              ({videos.length})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {headerActions}
          {showViewAll && viewAllHref && (
            <a
              href={viewAllHref}
              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t.common?.viewAll || 'View All'}
            </a>
          )}
        </div>
      </div>

      {/* Section Content */}
      {expanded && (
        <div className="section-content">
          {/* Error State */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-red-600 dark:text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-sm text-red-700 dark:text-red-400">
                  {error}
                </p>
              </div>
            </div>
          )}

          {/* Custom Content or Video Grid */}
          {children || (
            <VideoGrid
              videos={videos}
              loading={loading}
              emptyMessage={emptyMessage}
              columns={{
                mobile: 1,
                tablet: 2,
                desktop: 3,
              }}
            />
          )}

          {/* Load More Button */}
          {!loading && hasMore && onLoadMore && (
            <div className="flex justify-center mt-6">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
              >
                {loadingMore ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    {t.common?.loading || 'Loading...'}
                  </>
                ) : (
                  <>
                    {t.common?.loadMore || 'Load More'}
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Skeleton loader for section while loading
 */
export function VideoSectionSkeleton({ title }: { title: string }) {
  return (
    <section className="video-section animate-pulse">
      <div className="flex items-center justify-between mb-4 px-4 md:px-0">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          {title}
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="space-y-2">
            <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded-lg" />
            <div className="space-y-2 p-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
