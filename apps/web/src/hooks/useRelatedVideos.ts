'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchRelatedVideos } from '@/lib/api/videos';
import { logger } from '@/lib/logger-client';
import type { VideoInfo } from '@/interfaces';

/** The shelf's load outcome: an empty list is a successful answer, not an error (#1552). */
export type RelatedShelfStatus = 'loading' | 'error' | 'success';

export interface RelatedShelf {
  videos: VideoInfo[];
  status: RelatedShelfStatus;
  /** Ask for the shelf again (the failure state's Try again). */
  retry: () => void;
}

/**
 * The watch page's related shelf: requested alongside the video details, so it
 * is not asked for again when the auth state settles — only when the viewer
 * retries a failed load.
 */
export function useRelatedVideos(videoId: string): RelatedShelf {
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [status, setStatus] = useState<RelatedShelfStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    setVideos([]);
    setStatus('loading');
    fetchRelatedVideos(videoId)
      .then((loaded) => {
        if (!cancelled) {
          setVideos(loaded);
          setStatus('success');
        }
      })
      .catch((error) => {
        logger.warn('[WatchPage] Related videos failed to load', { videoId, error });
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [videoId, attempt]);

  return { videos, status, retry };
}
