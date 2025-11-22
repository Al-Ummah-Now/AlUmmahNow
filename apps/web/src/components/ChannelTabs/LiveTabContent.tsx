'use client';

import React, { useEffect, useState } from 'react';
import { VideoGrid } from '@/components/VideoGrid';
import { useLanguage } from '@/hooks/useLanguage';
import { getChannelLiveStreams } from '@/lib/api/channels';
import { logger } from '@/lib/logger-client';
import { VideoObject } from '@al-ummah/shared-types';

interface LiveTabContentProps {
  channelId: string;
}

export function LiveTabContent({ channelId }: LiveTabContentProps) {
  const { t } = useLanguage();
  const [liveStreams, setLiveStreams] = useState<VideoObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (liveStreams.length === 0) {
      setLoading(true);
      setError(null);

      logger.info('Fetching channel live streams', { channelId });

      getChannelLiveStreams(channelId, { limit: 20 })
        .then((response) => {
          if (response && response.data) {
            setLiveStreams(response.data);
            logger.info('Channel live streams loaded', { count: response.data.length });
          } else {
            logger.warn('No live streams response', { channelId });
          }
        })
        .catch((error) => {
          logger.error('Failed to fetch channel live streams', { channelId, error });
          setError(t.common.error || 'Failed to load live streams');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [channelId, liveStreams.length, t]);

  return (
    <div role="tabpanel" id="tabpanel-live" aria-labelledby="tab-live">
      {error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : (
        <VideoGrid
          videos={liveStreams}
          loading={loading}
          emptyMessage={t.channel.liveNowDescription}
        />
      )}
    </div>
  );
}
