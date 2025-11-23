'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { VideoObject } from '@al-ummah/shared-types';
import { VideoSection } from './VideoSection';
import {
  getRecommendedVideos,
  type RecommendedVideosParams
} from '@/lib/api/sections';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

export interface RecommendedVideosSectionProps {
  initialVideos?: VideoObject[];
  initialStrategy?: 'popular' | 'category-based' | 'random';
  userId?: string;
  seedVideoId?: string;
  limit?: number;
  showStrategySelector?: boolean;
  showViewAll?: boolean;
  className?: string;
}

type StrategyOption = 'popular' | 'category-based' | 'random';

/**
 * Recommended Videos Section Component
 * Displays recommended videos with strategy selector
 */
export function RecommendedVideosSection({
  initialVideos = [],
  initialStrategy = 'popular',
  userId,
  seedVideoId,
  limit = 12,
  showStrategySelector = false,
  showViewAll = true,
  className = '',
}: RecommendedVideosSectionProps) {
  const { t } = useLanguage();
  const [videos, setVideos] = useState<VideoObject[]>(initialVideos);
  const [loading, setLoading] = useState(initialVideos.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false); // Recommended videos typically don't paginate
  const [strategy, setStrategy] = useState<StrategyOption>(initialStrategy);
  const [basedOn, setBasedOn] = useState<string | undefined>();

  const fetchVideos = useCallback(async (loadMore = false) => {
    try {
      if (loadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const params: RecommendedVideosParams = {
        limit,
        strategy,
        excludeWatched: !!userId,
        seedVideoId,
      };

      if (loadMore && cursor) {
        params.cursor = cursor;
      }

      logger.info('[RecommendedVideosSection] Fetching videos', { params, userId, loadMore });
      const response = await getRecommendedVideos(params, userId ? { userId } : undefined);

      if (!response) {
        throw new Error('Failed to fetch recommended videos');
      }

      if (response.success) {
        if (loadMore) {
          setVideos(prev => [...prev, ...response.data]);
        } else {
          setVideos(response.data);
        }

        setCursor(response.cursor);
        setHasMore(!!response.cursor);
        setBasedOn(response.metadata.basedOn);
        logger.info('[RecommendedVideosSection] Videos loaded', {
          count: response.data.length,
          hasMore: !!response.cursor,
          strategy: response.metadata.strategy,
          basedOn: response.metadata.basedOn
        });
      } else {
        throw new Error('API returned unsuccessful response');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[RecommendedVideosSection] Error fetching videos', { error: errorMessage });
      setError(errorMessage);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [limit, strategy, userId, seedVideoId, cursor]);

  // Fetch recommended videos when strategy changes
  useEffect(() => {
    if (initialVideos.length === 0 || strategy !== initialStrategy) {
      fetchVideos();
    }
  }, [strategy, userId, seedVideoId, initialVideos.length, initialStrategy, fetchVideos]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchVideos(true);
    }
  };

  const handleStrategyChange = (newStrategy: StrategyOption) => {
    if (newStrategy !== strategy) {
      setStrategy(newStrategy);
      setCursor(undefined);
      setHasMore(false);
    }
  };

  const strategyOptions: { value: StrategyOption; label: string; icon: string }[] = [
    {
      value: 'popular',
      label: t.sections?.strategyPopular || 'Popular',
      icon: '⭐'
    },
    {
      value: 'category-based',
      label: t.sections?.strategyCategoryBased || 'Similar',
      icon: '🎯'
    },
    {
      value: 'random',
      label: t.sections?.strategyRandom || 'Discover',
      icon: '🎲'
    },
  ];

  const strategySelector = showStrategySelector ? (
    <div className="flex gap-2">
      {strategyOptions.map((option) => (
        <button
          key={option.value}
          onClick={() => handleStrategyChange(option.value)}
          disabled={loading}
          className={`
            px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5
            ${strategy === option.value
              ? 'bg-purple-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          <span>{option.icon}</span>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  ) : undefined;

  const title = (
    <div className="flex flex-col">
      <div className="flex items-center gap-2">
        <svg
          className="w-6 h-6 text-purple-500"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
        <span>{t.sections?.recommendedVideos || 'Recommended for You'}</span>
      </div>
      {basedOn && (
        <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t.sections?.basedOn || 'Based on'}: {basedOn}
        </span>
      )}
    </div>
  );

  return (
    <VideoSection
      title={title}
      videos={videos}
      loading={loading}
      error={error}
      onLoadMore={hasMore ? handleLoadMore : undefined}
      hasMore={hasMore}
      loadingMore={loadingMore}
      emptyMessage={t.sections?.noRecommendedVideos || 'No recommended videos available'}
      className={className}
      showViewAll={showViewAll}
      viewAllHref={`/sections/recommended?strategy=${strategy}`}
      headerActions={strategySelector}
    />
  );
}
