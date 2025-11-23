'use client';

import React, { useState, useEffect } from 'react';
import { VideoObject } from '@al-ummah/shared-types';
import { VideoSection } from './VideoSection';
import { getPopularVideos, type PopularVideosParams } from '@/lib/api/sections';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

export interface PopularVideosSectionProps {
  initialVideos?: VideoObject[];
  initialPeriod?: 'all' | 'monthly' | 'weekly' | 'daily';
  limit?: number;
  showPeriodSelector?: boolean;
  showViewAll?: boolean;
  className?: string;
}

type PeriodOption = 'all' | 'monthly' | 'weekly' | 'daily';

/**
 * Popular Videos Section Component
 * Displays popular videos with time period selector
 */
export function PopularVideosSection({
  initialVideos = [],
  initialPeriod = 'weekly',
  limit = 12,
  showPeriodSelector = true,
  showViewAll = true,
  className = '',
}: PopularVideosSectionProps) {
  const { t } = useLanguage();
  const [videos, setVideos] = useState<VideoObject[]>(initialVideos);
  const [loading, setLoading] = useState(initialVideos.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [period, setPeriod] = useState<PeriodOption>(initialPeriod);

  // Fetch popular videos when period changes
  useEffect(() => {
    if (initialVideos.length === 0 || period !== initialPeriod) {
      fetchVideos();
    }
  }, [period]);

  const fetchVideos = async (loadMore = false) => {
    try {
      if (loadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const params: PopularVideosParams = {
        limit,
        period,
      };

      if (loadMore && cursor) {
        params.cursor = cursor;
      }

      logger.info('[PopularVideosSection] Fetching videos', { params, loadMore });
      const response = await getPopularVideos(params);

      if (!response) {
        throw new Error('Failed to fetch popular videos');
      }

      if (response.success) {
        if (loadMore) {
          setVideos(prev => [...prev, ...response.data]);
        } else {
          setVideos(response.data);
        }

        setCursor(response.cursor);
        setHasMore(!!response.cursor);
        logger.info('[PopularVideosSection] Videos loaded', {
          count: response.data.length,
          hasMore: !!response.cursor,
          period: response.metadata.period
        });
      } else {
        throw new Error('API returned unsuccessful response');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[PopularVideosSection] Error fetching videos', { error: errorMessage });
      setError(errorMessage);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchVideos(true);
    }
  };

  const handlePeriodChange = (newPeriod: PeriodOption) => {
    if (newPeriod !== period) {
      setPeriod(newPeriod);
      setCursor(undefined);
      setHasMore(true);
    }
  };

  const periodOptions: { value: PeriodOption; label: string }[] = [
    { value: 'daily', label: t.sections?.periodDaily || 'Today' },
    { value: 'weekly', label: t.sections?.periodWeekly || 'This Week' },
    { value: 'monthly', label: t.sections?.periodMonthly || 'This Month' },
    { value: 'all', label: t.sections?.periodAll || 'All Time' },
  ];

  const periodSelector = showPeriodSelector ? (
    <div className="flex gap-2">
      {periodOptions.map((option) => (
        <button
          key={option.value}
          onClick={() => handlePeriodChange(option.value)}
          disabled={loading}
          className={`
            px-3 py-1.5 rounded-md text-sm font-medium transition-colors
            ${period === option.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          {option.label}
        </button>
      ))}
    </div>
  ) : undefined;

  return (
    <VideoSection
      title={t.sections?.popularVideos || 'Popular Videos'}
      videos={videos}
      loading={loading}
      error={error}
      onLoadMore={handleLoadMore}
      hasMore={hasMore}
      loadingMore={loadingMore}
      emptyMessage={t.sections?.noPopularVideos || 'No popular videos available'}
      className={className}
      showViewAll={showViewAll}
      viewAllHref={`/sections/popular?period=${period}`}
      headerActions={periodSelector}
    />
  );
}
