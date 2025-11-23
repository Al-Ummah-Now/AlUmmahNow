'use client';

import React, { useState, useEffect } from 'react';
import { VideoObject } from '@al-ummah/shared-types';
import { VideoSection } from './VideoSection';
import { getRecentVideos, type RecentVideosParams } from '@/lib/api/sections';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';

export interface RecentVideosSectionProps {
  initialVideos?: VideoObject[];
  channelId?: string;
  excludeChannels?: string[];
  limit?: number;
  showViewAll?: boolean;
  className?: string;
}

/**
 * Recent Videos Section Component
 * Displays recently uploaded videos with automatic refresh
 */
export function RecentVideosSection({
  initialVideos = [],
  channelId,
  excludeChannels,
  limit = 12,
  showViewAll = true,
  className = '',
}: RecentVideosSectionProps) {
  const { t } = useLanguage();
  const [videos, setVideos] = useState<VideoObject[]>(initialVideos);
  const [loading, setLoading] = useState(initialVideos.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);

  // Fetch recent videos on mount
  useEffect(() => {
    if (initialVideos.length === 0) {
      fetchVideos();
    }
  }, []);

  const fetchVideos = async (loadMore = false) => {
    try {
      if (loadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const params: RecentVideosParams = {
        limit,
        channelId,
        excludeChannels,
      };

      if (loadMore && cursor) {
        params.cursor = cursor;
      }

      logger.info('[RecentVideosSection] Fetching videos', { params, loadMore });
      const response = await getRecentVideos(params);

      if (!response) {
        throw new Error('Failed to fetch recent videos');
      }

      if (response.success) {
        if (loadMore) {
          setVideos(prev => [...prev, ...response.data]);
        } else {
          setVideos(response.data);
        }

        setCursor(response.cursor);
        setHasMore(!!response.cursor);
        logger.info('[RecentVideosSection] Videos loaded', {
          count: response.data.length,
          hasMore: !!response.cursor
        });
      } else {
        throw new Error('API returned unsuccessful response');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[RecentVideosSection] Error fetching videos', { error: errorMessage });
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

  return (
    <VideoSection
      title={t.sections?.recentVideos || 'Recent Uploads'}
      videos={videos}
      loading={loading}
      error={error}
      onLoadMore={handleLoadMore}
      hasMore={hasMore}
      loadingMore={loadingMore}
      emptyMessage={t.sections?.noRecentVideos || 'No recent videos available'}
      className={className}
      showViewAll={showViewAll}
      viewAllHref="/sections/recent"
    />
  );
}
