'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { VideoSection } from './VideoSection';
import {
  getTrendingVideos,
  type TrendingVideosParams,
  type TrendingVideoObject
} from '@/lib/api/sections';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import VideoCard from '@/components/videoCard';

export interface TrendingVideosSectionProps {
  initialVideos?: TrendingVideoObject[];
  initialAlgorithm?: 'velocity' | 'engagement' | 'hybrid';
  initialTimeWindow?: '6h' | '12h' | '24h' | '48h';
  limit?: number;
  showAlgorithmSelector?: boolean;
  showTrendingBadges?: boolean;
  showViewAll?: boolean;
  className?: string;
}

type AlgorithmOption = 'velocity' | 'engagement' | 'hybrid';
type TimeWindowOption = '6h' | '12h' | '24h' | '48h';

/**
 * Trending Videos Section Component
 * Displays trending videos with algorithm selector and trending indicators
 */
export function TrendingVideosSection({
  initialVideos = [],
  initialAlgorithm = 'hybrid',
  initialTimeWindow = '24h',
  limit = 12,
  showAlgorithmSelector = false,
  showTrendingBadges = true,
  showViewAll = true,
  className = '',
}: TrendingVideosSectionProps) {
  const { t, isRTL } = useLanguage();
  const [videos, setVideos] = useState<TrendingVideoObject[]>(initialVideos);
  const [loading, setLoading] = useState(initialVideos.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [algorithm, setAlgorithm] = useState<AlgorithmOption>(initialAlgorithm);
  const [timeWindow] = useState<TimeWindowOption>(initialTimeWindow);

  const fetchVideos = useCallback(async (loadMore = false) => {
    try {
      if (loadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const params: TrendingVideosParams = {
        limit,
        algorithm,
        timeWindow,
      };

      if (loadMore && cursor) {
        params.cursor = cursor;
      }

      logger.info('[TrendingVideosSection] Fetching videos', { params, loadMore });
      const response = await getTrendingVideos(params);

      if (!response) {
        throw new Error('Failed to fetch trending videos');
      }

      if (response.success) {
        if (loadMore) {
          setVideos(prev => [...prev, ...response.data]);
        } else {
          setVideos(response.data);
        }

        setCursor(response.cursor);
        setHasMore(!!response.cursor);
        logger.info('[TrendingVideosSection] Videos loaded', {
          count: response.data.length,
          hasMore: !!response.cursor,
          algorithm: response.metadata.algorithmVersion
        });
      } else {
        throw new Error('API returned unsuccessful response');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[TrendingVideosSection] Error fetching videos', { error: errorMessage });
      setError(errorMessage);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [limit, algorithm, timeWindow, cursor]);

  // Fetch trending videos when algorithm or timeWindow changes
  useEffect(() => {
    if (initialVideos.length === 0 || algorithm !== initialAlgorithm || timeWindow !== initialTimeWindow) {
      fetchVideos();
    }
  }, [algorithm, timeWindow, initialVideos.length, initialAlgorithm, initialTimeWindow, fetchVideos]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchVideos(true);
    }
  };

  const handleAlgorithmChange = (newAlgorithm: AlgorithmOption) => {
    if (newAlgorithm !== algorithm) {
      setAlgorithm(newAlgorithm);
      setCursor(undefined);
      setHasMore(true);
    }
  };

  const algorithmSelector = showAlgorithmSelector ? (
    <div className="flex gap-2">
      {(['velocity', 'engagement', 'hybrid'] as AlgorithmOption[]).map((alg) => (
        <button
          key={alg}
          onClick={() => handleAlgorithmChange(alg)}
          disabled={loading}
          className={`
            px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors
            ${algorithm === alg
              ? 'bg-orange-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          {alg}
        </button>
      ))}
    </div>
  ) : undefined;

  // Wrap videos with trending badges if enabled - return array of JSX elements
  const videosWithBadges = showTrendingBadges
    ? videos.map((video) => (
        <TrendingVideoCard key={video.id} video={video} isRTL={isRTL} />
      ))
    : null; // Return null when not showing badges, VideoSection will render videos prop instead

  return (
    <VideoSection
      title={
        <div className="flex items-center gap-2">
          <svg
            className="w-6 h-6 text-orange-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"
              clipRule="evenodd"
            />
          </svg>
          <span>{t.sections?.trendingVideos || 'Trending'}</span>
        </div>
      }
      videos={showTrendingBadges ? [] : videos}
      loading={loading}
      error={error}
      onLoadMore={handleLoadMore}
      hasMore={hasMore}
      loadingMore={loadingMore}
      emptyMessage={t.sections?.noTrendingVideos || 'No trending videos available'}
      className={className}
      showViewAll={showViewAll}
      viewAllHref={`/sections/trending?algorithm=${algorithm}&timeWindow=${timeWindow}`}
      headerActions={algorithmSelector}
    >
      {showTrendingBadges && !loading && videosWithBadges && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" dir={isRTL ? 'rtl' : 'ltr'}>
          {videosWithBadges}
        </div>
      )}
    </VideoSection>
  );
}

/**
 * Trending Video Card with badge
 */
function TrendingVideoCard({ video, isRTL }: { video: TrendingVideoObject; isRTL: boolean }) {
  const trendingBadge = (
    <div
      className={`absolute top-2 ${isRTL ? 'left-2' : 'right-2'} bg-orange-500 text-white px-2 py-1 rounded-md flex items-center gap-1 text-xs font-bold shadow-lg z-10`}
    >
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z" />
      </svg>
      #{video.trendingMetadata.rank}
    </div>
  );

  const velocityIndicator = video.trendingMetadata.percentageIncrease > 0 && (
    <div className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs font-medium">
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M5.293 7.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L6.707 7.707a1 1 0 01-1.414 0z"
          clipRule="evenodd"
        />
      </svg>
      <span>+{video.trendingMetadata.percentageIncrease}%</span>
    </div>
  );

  return (
    <div className="relative">
      {trendingBadge}
      <VideoCard {...video} />
      {velocityIndicator && (
        <div className="px-4 py-2">
          {velocityIndicator}
        </div>
      )}
    </div>
  );
}
