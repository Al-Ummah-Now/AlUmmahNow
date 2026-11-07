'use client';

/**
 * Load a video's subtitle tracks for the player (public endpoint).
 */

import { useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';
import { toPlayerTextTracks, type PlayerTextTrack } from '@/lib/video/subtitle-tracks';
import type { ApiSubtitleTrack } from '@/lib/api/subtitle-utils';

export function useVideoSubtitles(videoId: string | undefined, uiLocale: string, enabled = true): PlayerTextTrack[] {
  const [tracks, setTracks] = useState<PlayerTextTrack[]>([]);

  useEffect(() => {
    if (!enabled || !videoId) {
      setTracks([]);
      return;
    }

    const controller = new AbortController();
    const apiUrl = getApiUrl();

    (async () => {
      try {
        const response = await fetch(`${apiUrl}/api/videos/${encodeURIComponent(videoId)}/subtitles`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setTracks([]);
          return;
        }
        const data = await response.json();
        const apiTracks = (data?.data?.tracks || []) as ApiSubtitleTrack[];
        setTracks(toPlayerTextTracks(apiTracks, { apiUrl, videoId, uiLocale }));
      } catch (error) {
        if (controller.signal.aborted) return;
        logger.warn('[useVideoSubtitles] Failed to load subtitles', { videoId, error });
        setTracks([]);
      }
    })();

    return () => controller.abort();
  }, [videoId, uiLocale, enabled]);

  return tracks;
}
