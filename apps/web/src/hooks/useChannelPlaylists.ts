'use client';

/**
 * The upload channel's playlists for the upload page's pickers, and creating
 * one inline (it joins the list at once, first).
 */
import { useCallback, useEffect, useState } from 'react';
import type { PlaylistWithVideos } from '@/lib/api/playlists';
import { createChannelPlaylist, listChannelPlaylists, type NewPlaylistInput } from '@/lib/api/upload-playlists-client';
import { reportError } from '@/lib/errors/reporter';
import { logger } from '@/lib/logger-client';

export function useChannelPlaylists(channelId: string) {
  const [playlists, setPlaylists] = useState<PlaylistWithVideos[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    listChannelPlaylists(channelId)
      .then((list) => {
        if (cancelled) return;
        if (list === null) {
          logger.warn('[ChannelPlaylists] Playlists not loaded', { channelId });
          setFailed(true);
          return;
        }
        setPlaylists(list);
      })
      .catch((error) => {
        if (cancelled) return;
        reportError(error, { extra: { component: 'upload-playlists', step: 'list' } });
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  /** Creates a playlist; resolves to it (already in the list), or null when it was not created. */
  const create = useCallback(async (input: NewPlaylistInput): Promise<PlaylistWithVideos | null> => {
    try {
      const playlist = await createChannelPlaylist(channelId, input);
      if (!playlist) {
        logger.warn('[ChannelPlaylists] Playlist not created', { channelId });
        return null;
      }
      setPlaylists((prev) => [playlist, ...prev.filter((p) => p.id !== playlist.id)]);
      return playlist;
    } catch (error) {
      reportError(error, { extra: { component: 'upload-playlists', step: 'create' } });
      return null;
    }
  }, [channelId]);

  return { playlists, loading, failed, create };
}
