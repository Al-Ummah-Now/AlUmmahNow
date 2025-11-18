'use client';

import { useEffect, useState } from 'react';
import { Playlist } from '@al-ummah/shared-types';
import Link from 'next/link';
import Image from 'next/image';
import { SectionHeader } from '../SectionHeader';

interface SinglePlaylistSectionProps {
  playlistId: string;
}

export function SinglePlaylistSection({ playlistId }: SinglePlaylistSectionProps) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('[SinglePlaylistSection] Fetching playlist:', playlistId);

    async function fetchPlaylist() {
      try {
        const response = await fetch(`/api/playlists/${playlistId}`);
        const data = await response.json();

        console.log('[SinglePlaylistSection] API response:', JSON.stringify(data, null, 2));

        if (data.success) {
          setPlaylist(data.playlist);
        }
      } catch (err) {
        console.error('[SinglePlaylistSection] Error fetching playlist:', JSON.stringify(err, null, 2));
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

  if (!playlist) {
    console.log('[SinglePlaylistSection] No playlist to display');
    return null;
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title={playlist.name}
        viewAllHref={`/en/playlist/${playlist.id}`}
      />

      <Link
        href={`/en/playlist/${playlist.id}`}
        className="block max-w-md group"
      >
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-xl transition-all duration-300">
          <div className="relative aspect-video bg-gray-200 dark:bg-gray-700">
            {playlist.thumbnailUrl && (
              <Image
                src={playlist.thumbnailUrl}
                alt={playlist.name}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-300"
              />
            )}
            <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
              {playlist.videosCount || 0} videos
            </div>
          </div>
          <div className="p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {playlist.name}
            </h3>
            {playlist.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-3">
                {playlist.description}
              </p>
            )}
          </div>
        </div>
      </Link>
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
