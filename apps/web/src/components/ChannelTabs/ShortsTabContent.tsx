'use client';

import React, { useEffect, useState } from 'react';
import { VideoGrid } from '@/components/VideoGrid';
import { useLanguage } from '@/hooks/useLanguage';
import { getChannelShorts } from '@/lib/api/channels';
import { logger } from '@/lib/logger-client';
import { VideoObject } from '@al-ummah/shared-types';

interface ShortsTabContentProps {
  channelId: string;
}

export function ShortsTabContent({ channelId }: ShortsTabContentProps) {
  const { t } = useLanguage();
  const [shorts, setShorts] = useState<VideoObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (shorts.length === 0) {
      setLoading(true);
      setError(null);

      logger.debug('Fetching channel shorts', { channelId });

      getChannelShorts(channelId, { limit: 20 })
        .then((response) => {
          if (response && response.data) {
            setShorts(response.data);
            logger.debug('Channel shorts loaded', { count: response.data.length });
          } else {
            logger.warn('No shorts response', { channelId });
          }
        })
        .catch((error) => {
          logger.error('Failed to fetch channel shorts', { channelId, error });
          setError(t.common.error || 'Failed to load shorts');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [channelId, shorts.length, t]);

  return (
    <div role="tabpanel" id="tabpanel-shorts" data-testid="tabpanel-shorts" aria-labelledby="tab-shorts">
      {error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : (
        <VideoGrid
          videos={shorts}
          loading={loading}
          emptyMessage={t.video.noVideosAvailable}
          columns={{ mobile: 2, tablet: 3, desktop: 4 }}
        />
      )}
    </div>
  );
}
