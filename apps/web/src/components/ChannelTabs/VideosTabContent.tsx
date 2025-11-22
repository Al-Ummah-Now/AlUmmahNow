'use client';

import React, { useEffect, useState } from 'react';
import { VideoGrid } from '@/components/VideoGrid';
import { useLanguage } from '@/hooks/useLanguage';
import { getChannelVideos } from '@/lib/api/channels';
import { logger } from '@/lib/logger-client';
import { VideoObject } from '@al-ummah/shared-types';

interface VideosTabContentProps {
  channelId: string;
}

export function VideosTabContent({ channelId }: VideosTabContentProps) {
  const { t } = useLanguage();
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (videos.length === 0) {
      setLoading(true);
      setError(null);

      logger.info('Fetching channel videos', { channelId });

      getChannelVideos(channelId, { limit: 20 })
        .then((response) => {
          if (response && response.data) {
            setVideos(response.data);
            logger.info('Channel videos loaded', { count: response.data.length });
          } else {
            logger.warn('No videos response', { channelId });
          }
        })
        .catch((error) => {
          logger.error('Failed to fetch channel videos', { channelId, error });
          setError(t.common.error || 'Failed to load videos');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [channelId, videos.length, t]);

  return (
    <div role="tabpanel" id="tabpanel-videos" aria-labelledby="tab-videos">
      {error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : (
        <VideoGrid
          videos={videos}
          loading={loading}
          emptyMessage={t.video.noVideosAvailable}
        />
      )}
    </div>
  );
}
