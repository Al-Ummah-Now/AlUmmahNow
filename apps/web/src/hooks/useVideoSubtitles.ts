'use client';

/**
 * Load a video's subtitle tracks for the player.
 *
 * Captions follow the video's own visibility (api-videos lib/videoReadAccess.ts): a video open to
 * anyone serves its tracks to everyone by URL. A private, scheduled, still-processing or held
 * video serves them only to its owner and allowed channel members (the list says `restricted`),
 * so each track is fetched with the viewer's token and handed to the player as a blob URL: the
 * player's own track request carries no token and would get the 404.
 */

import { useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';
import { fetchClientAuthInfo } from '@/lib/auth/client-token';
import { toPlayerTextTracks, type PlayerTextTrack } from '@/lib/video/subtitle-tracks';
import type { ApiSubtitleTrack } from '@/lib/api/subtitle-utils';
import { useLanguage } from '@/hooks/useLanguage';

export function useVideoSubtitles(videoId: string | undefined, uiLocale: string, enabled = true): PlayerTextTrack[] {
  const [tracks, setTracks] = useState<PlayerTextTrack[]>([]);
  const { t } = useLanguage();
  const machineLabel = t.captions?.viewer?.machineTranslation;

  useEffect(() => {
    if (!enabled || !videoId) {
      setTracks([]);
      return;
    }

    const controller = new AbortController();
    const apiUrl = getApiUrl();
    const blobUrls: string[] = [];

    (async () => {
      try {
        const token = (await fetchClientAuthInfo().catch(() => null))?.accessToken;
        const auth: HeadersInit | undefined = token ? { Authorization: `Bearer ${token}` } : undefined;
        const response = await fetch(`${apiUrl}/api/videos/${encodeURIComponent(videoId)}/subtitles`, {
          signal: controller.signal,
          ...(auth ? { headers: auth } : {}),
        });
        if (!response.ok) {
          setTracks([]);
          return;
        }
        const data = await response.json();
        const apiTracks = (data?.data?.tracks || []) as ApiSubtitleTrack[];
        const playerTracks = toPlayerTextTracks(apiTracks, { apiUrl, videoId, uiLocale, ...(machineLabel ? { machineLabel } : {}) });
        if (data?.data?.restricted !== true || !auth) {
          setTracks(playerTracks);
          return;
        }
        // Owner-only video: fetch each track with the token; a track that fails is left out
        const loaded = await Promise.all(
          playerTracks.map(async (track) => {
            const res = await fetch(track.src, { signal: controller.signal, headers: auth, cache: 'no-store' });
            if (!res.ok) return null;
            const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/vtt' }));
            blobUrls.push(url);
            return { ...track, src: url };
          }),
        );
        if (controller.signal.aborted) return;
        setTracks(loaded.filter((track): track is PlayerTextTrack => track !== null));
      } catch (error) {
        if (controller.signal.aborted) return;
        logger.warn('[useVideoSubtitles] Failed to load subtitles', { videoId, error });
        setTracks([]);
      }
    })();

    return () => {
      controller.abort();
      for (const url of blobUrls) URL.revokeObjectURL(url);
    };
  }, [videoId, uiLocale, enabled, machineLabel]);

  return tracks;
}
