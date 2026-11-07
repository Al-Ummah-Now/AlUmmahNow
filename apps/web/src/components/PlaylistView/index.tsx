'use client';

/**
 * Playlist page content: playlist info, "Play all" and the ordered videos.
 * Owners can reorder and remove videos inline.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowDown, ArrowUp, ListVideo, Lock, Play, Trash2 } from 'lucide-react';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { logger } from '@/lib/logger-client';
import { removeUnwantedChars, resolveUrl } from '@/lib/utility';
import {
  getPlaylistById,
  removeVideoFromPlaylist,
  updatePlaylist,
  type PlaylistWithVideos,
} from '@/lib/api/playlists';
import { formatDuration, getPlayAllHref, getWatchHref, moveItem } from '@/lib/playlists/playlist-utils';
import type { VideoObject } from '@/interfaces';

interface PlaylistViewProps {
  playlistId: string;
}

export default function PlaylistView({ playlistId }: PlaylistViewProps) {
  const { t, lang, isRTL } = useLanguage();
  const { user } = useAuth();
  const [playlist, setPlaylist] = useState<PlaylistWithVideos | null>(null);
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPlaylistById(playlistId, undefined, { includeVideos: true });
      setPlaylist(result);
      setVideos(result?.videoItems || []);
      logger.info('[PlaylistView] Playlist loaded', {
        playlistId,
        found: !!result,
        videos: result?.videoItems?.length || 0,
      });
    } catch (error) {
      logger.error('[PlaylistView] Failed to load playlist', { playlistId, error });
      setPlaylist(null);
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    load();
  }, [load]);

  const isOwner = !!user && !!playlist && playlist.userId === user.id;

  const handleMove = async (from: number, to: number) => {
    if (!playlist || busy) return;
    const previous = videos;
    const reordered = moveItem(videos, from, to);
    setVideos(reordered);
    setActionError(null);
    setBusy(true);

    // The API requires the full current ID list; keep IDs we could not
    // display (e.g. private videos of others) at the end in their old order.
    const shownIds = reordered.map((v) => v.id);
    const hiddenIds = (playlist.videos || []).filter((id) => !shownIds.includes(id));
    const result = await updatePlaylist(
      playlist.id,
      { videos: [...shownIds, ...hiddenIds] },
      { channelId: playlist.channelId }
    );
    setBusy(false);

    if (!result?.success) {
      logger.error('[PlaylistView] Reorder failed', { playlistId, error: result?.error });
      setVideos(previous);
      setActionError(t.playlist.reorderFailed);
      return;
    }
    setPlaylist({ ...playlist, videos: [...shownIds, ...hiddenIds] });
  };

  const handleRemove = async (videoId: string) => {
    if (!playlist || busy) return;
    setActionError(null);
    setBusy(true);
    const result = await removeVideoFromPlaylist(playlist.id, videoId, { channelId: playlist.channelId });
    setBusy(false);

    if (!result?.success) {
      logger.error('[PlaylistView] Remove failed', { playlistId, videoId, error: result?.error });
      setActionError(t.playlist.removeFailed);
      return;
    }
    setVideos((prev) => prev.filter((v) => v.id !== videoId));
    setPlaylist({ ...playlist, videos: (playlist.videos || []).filter((id) => id !== videoId) });
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8 animate-pulse" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-8" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4 mb-4">
            <div className="w-40 aspect-video bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center" dir={isRTL ? 'rtl' : 'ltr'}>
        <ListVideo className="w-12 h-12 mx-auto text-gray-400 mb-4" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t.playlist.notFound}</h1>
        <p className="text-gray-600 dark:text-gray-400">{t.playlist.notFoundDescription}</p>
      </div>
    );
  }

  const title = playlist.name || playlist.title;
  const playAllHref = getPlayAllHref(lang, videos);
  const coverUrl = playlist.thumbnailUrl || videos[0]?.thumbnailUrl;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-col md:flex-row gap-6">
        {/* Playlist info */}
        <aside className="md:w-80 flex-shrink-0">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-md overflow-hidden md:sticky md:top-20">
            <div className="relative aspect-video bg-gray-200 dark:bg-gray-700">
              {coverUrl && (
                <Image src={resolveUrl(coverUrl)} alt={title} fill className="object-cover" sizes="(max-width: 768px) 100vw, 320px" />
              )}
            </div>
            <div className="p-4 space-y-3">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white break-words">{title}</h1>
              {playlist.channelName && (
                <Link
                  href={`/${lang}/channels/${playlist.channelId}`}
                  className="block text-sm text-gray-700 dark:text-gray-300 hover:underline"
                >
                  {playlist.channelName}
                </Link>
              )}
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <span>{t.playlist.videoCount.replace('{count}', String(videos.length))}</span>
                <span aria-hidden="true">•</span>
                <span className="inline-flex items-center gap-1">
                  {playlist.isPublic === false && <Lock className="w-3.5 h-3.5" />}
                  {playlist.isPublic === false ? t.playlist.privateLabel : t.playlist.publicLabel}
                </span>
              </div>
              {playlist.dateModified && (
                <p className="text-xs text-gray-500">
                  {t.playlist.updatedOn.replace('{date}', new Date(playlist.dateModified).toLocaleDateString(lang))}
                </p>
              )}
              {playlist.description && (
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">{playlist.description}</p>
              )}
              {playAllHref && (
                <Link
                  href={playAllHref}
                  className="inline-flex w-full items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
                >
                  <Play className={`w-4 h-4 ${isRTL ? 'rotate-180' : ''}`} />
                  {t.playlist.playAll}
                </Link>
              )}
            </div>
          </div>
        </aside>

        {/* Ordered videos */}
        <section className="flex-1 min-w-0">
          {actionError && (
            <div role="alert" className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
              {actionError}
            </div>
          )}

          {videos.length === 0 ? (
            <div className="p-8 text-center bg-gray-50 dark:bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
              <p className="text-gray-600 dark:text-gray-400">{t.playlist.emptyPlaylist}</p>
            </div>
          ) : (
            <ol className="space-y-3">
              {videos.map((video, index) => {
                const videoTitle = removeUnwantedChars(getLocalizedValue(video.titleLocalized, video.title, lang));
                const duration = formatDuration(video.duration);
                return (
                  <li key={video.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60">
                    <span className="w-6 text-center text-sm text-gray-500 flex-shrink-0">{index + 1}</span>
                    <Link href={getWatchHref(lang, video.id)} className="flex flex-1 min-w-0 items-center gap-3 group">
                      <div className="relative w-32 sm:w-40 aspect-video flex-shrink-0 rounded overflow-hidden bg-gray-200 dark:bg-gray-700">
                        {video.thumbnailUrl && (
                          <Image src={resolveUrl(video.thumbnailUrl)} alt={videoTitle} fill className="object-cover" sizes="160px" />
                        )}
                        {duration && (
                          <span className={`absolute bottom-1 ${isRTL ? 'left-1' : 'right-1'} bg-black/80 text-white text-xs px-1 rounded`}>
                            {duration}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-sm sm:text-base font-medium text-gray-900 dark:text-white line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                          {videoTitle}
                        </h2>
                        {video.channelName && (
                          <p className="text-xs text-gray-600 dark:text-gray-400 truncate">{video.channelName}</p>
                        )}
                      </div>
                    </Link>

                    {isOwner && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMove(index, index - 1)}
                          disabled={busy || index === 0}
                          className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30"
                          aria-label={t.playlist.moveUp}
                          title={t.playlist.moveUp}
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(index, index + 1)}
                          disabled={busy || index === videos.length - 1}
                          className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30"
                          aria-label={t.playlist.moveDown}
                          title={t.playlist.moveDown}
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(video.id)}
                          disabled={busy}
                          className="p-2 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-30"
                          aria-label={t.playlist.removeFromPlaylist}
                          title={t.playlist.removeFromPlaylist}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
