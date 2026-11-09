'use client';

import { pickLanguage } from '@/lib/format/pick-language';
import { useEffect, useState } from 'react';
import { Playlist } from '@al-ummah/shared-types';
import Link from 'next/link';
import { SectionHeader } from '../SectionHeader';
import { getPlaylistById } from '@/lib/api/playlists';
import { useLanguage } from '@/hooks/useLanguage';
import { PlaylistCover } from '@/components/PlaylistCover';
import { logger } from '@/lib/logger-client';

interface SinglePlaylistSectionProps {
  playlistId: string;
}

export function SinglePlaylistSection({ playlistId }: SinglePlaylistSectionProps) {
  const { t, locale } = useLanguage();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logger.info('SinglePlaylistSection: Fetching playlist', { playlistId });

    async function fetchPlaylist() {
      try {
        const result = await getPlaylistById(playlistId, undefined, { includeVideos: true });

        logger.info('SinglePlaylistSection: API response received', {
          playlistId,
          found: !!result
        });

        if (result) {
          setPlaylist(result);
        }
      } catch (err) {
        logger.error('SinglePlaylistSection: Error fetching playlist', {
          playlistId,
          error: err instanceof Error ? err.message : String(err)
        });
      } finally {
        setLoading(false);
      }
    }

    if (playlistId) {
      fetchPlaylist();
    } else {
      setLoading(false);
    }
  }, [playlistId]);

  if (loading) {
    return <SectionSkeleton />;
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title={playlist?.name ? pickLanguage(playlist.name, locale) : t.channel.playlist}
        viewAllHref={playlist ? `/${locale}/playlist/${playlist.id}` : undefined}
      />

      {!playlist ? (
        <div className="flex items-center justify-center p-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t.channel.playlistNotFound}
          </p>
        </div>
      ) : (
      <Link
        href={`/${locale}/playlist/${playlist.id}`}
        className="block max-w-md group"
      >
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300">
          <PlaylistCover playlist={playlist} videos={(playlist as { videoItems?: Array<{ thumbnailUrl?: string | null }> }).videoItems} alt={pickLanguage(playlist.name, locale)}>
            <div className="absolute bottom-2 end-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
              {t.playlist.videoCount.replace('{count}', String(playlist.videosCount || 0))}
            </div>
          </PlaylistCover>
          <div className="p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {pickLanguage(playlist.name, locale)}
            </h3>
            {playlist.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-3">
                {pickLanguage(playlist.description, locale)}
              </p>
            )}
          </div>
        </div>
      </Link>
      )}
    </section>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48"></div>
      <div className="max-w-md space-y-2">
        <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
      </div>
    </div>
  );
}
