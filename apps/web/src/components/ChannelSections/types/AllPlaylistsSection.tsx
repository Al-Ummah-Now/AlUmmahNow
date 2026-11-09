'use client';

import { pickLanguage } from '@/lib/format/pick-language';
import { useEffect, useState } from 'react';
import { Playlist } from '@al-ummah/shared-types';
import Link from 'next/link';
import { SectionHeader } from '../SectionHeader';
import { listPlaylists } from '@/lib/api/playlists';
import { useLanguage } from '@/hooks/useLanguage';
import { PlaylistCover } from '@/components/PlaylistCover';
import { logger } from '@/lib/logger-client';

interface AllPlaylistsSectionProps {
  channelId: string;
}

export function AllPlaylistsSection({ channelId }: AllPlaylistsSectionProps) {
  const { t, locale } = useLanguage();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    logger.info('AllPlaylistsSection: Fetching playlists', { channelId });

    async function fetchPlaylists() {
      try {
        const result = await listPlaylists({
          channelId,
          limit: 12,
          isPublic: true
        });

        logger.info('AllPlaylistsSection: API response received', {
          channelId,
          playlistCount: result?.data?.length || 0
        });

        if (result && result.data) {
          setPlaylists(result.data);
        }
      } catch (err) {
        logger.error('AllPlaylistsSection: Error fetching playlists', {
          channelId,
          error: err instanceof Error ? err.message : String(err)
        });
      } finally {
        setLoading(false);
      }
    }

    fetchPlaylists();
  }, [channelId]);

  if (loading) {
    return <SectionSkeleton />;
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t.channel.allPlaylists}
        viewAllHref={playlists.length > 0 ? `/${locale}/channels/${channelId}/playlists` : undefined}
      />

      {playlists.length === 0 ? (
        <div className="flex items-center justify-center p-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t.channel.allPlaylistsDescription}
          </p>
        </div>
      ) : (
      <div className="relative">
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-4 pb-2">
            {playlists.map((playlist) => (
              <Link
                key={playlist.id}
                href={`/${locale}/playlist/${playlist.id}`}
                className="flex-shrink-0 w-64 sm:w-72 md:w-80 group"
              >
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300">
                  <PlaylistCover playlist={playlist} videos={(playlist as { videoItems?: Array<{ thumbnailUrl?: string | null }> }).videoItems} alt={pickLanguage(playlist.name, locale)}>
                    <div className="absolute bottom-2 end-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
                      {t.playlist.videoCount.replace('{count}', String(playlist.videosCount || 0))}
                    </div>
                  </PlaylistCover>
                  <div className="p-3">
                    <h3 className="font-semibold line-clamp-2 text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {pickLanguage(playlist.name, locale)}
                    </h3>
                    {playlist.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">
                        {pickLanguage(playlist.description, locale)}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {playlists.length > 5 && (
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white dark:from-gray-900 to-transparent pointer-events-none" />
        )}
      </div>
      )}
    </section>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48"></div>
      <div className="flex gap-4 overflow-x-auto">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex-shrink-0 w-64 space-y-2">
            <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    </div>
  );
}
