'use client';

import React, { useEffect, useState } from 'react';
import { PlaylistGrid } from '@/components/PlaylistGrid';
import { useLanguage } from '@/hooks/useLanguage';
import { getChannelPlaylists } from '@/lib/api/channels';
import { logger } from '@/lib/logger-client';
import { Playlist } from '@al-ummah/shared-types';

interface PlaylistsTabContentProps {
  channelId: string;
}

export function PlaylistsTabContent({ channelId }: PlaylistsTabContentProps) {
  const { t } = useLanguage();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (playlists.length === 0) {
      setLoading(true);
      setError(null);

      logger.info('Fetching channel playlists', { channelId });

      getChannelPlaylists(channelId, { limit: 20 })
        .then((response) => {
          if (response && response.data) {
            setPlaylists(response.data);
            logger.info('Channel playlists loaded', { count: response.data.length });
          } else {
            logger.warn('No playlists response', { channelId });
          }
        })
        .catch((error) => {
          logger.error('Failed to fetch channel playlists', { channelId, error });
          setError(t.common.error || 'Failed to load playlists');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [channelId, playlists.length, t]);

  return (
    <div role="tabpanel" id="tabpanel-playlists" data-testid="tabpanel-playlists" aria-labelledby="tab-playlists">
      {error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400">
          {error}
        </div>
      ) : (
        <PlaylistGrid
          playlists={playlists}
          loading={loading}
          emptyMessage={t.profile.noPlaylistsAvailable}
        />
      )}
    </div>
  );
}
