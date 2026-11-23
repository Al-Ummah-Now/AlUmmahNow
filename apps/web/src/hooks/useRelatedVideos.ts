'use client';

import { useCallback, useEffect, useState } from 'react';
import { logger } from '@/lib/logger-client';
import { VideoInfo } from '@/interfaces';
import { fetchRelatedVideos } from '@/lib/api/videos';

export type RelatedShelfStatus = 'loading' | 'error' | 'ready';

export interface RelatedShelf {
  /** The shelf's videos; empty while loading and after a failure */
  videos: VideoInfo[];
  /** loading: fetching; error: the request failed (retryable); ready: the answer is in, possibly empty */
  status: RelatedShelfStatus;
  /** Re-runs the request (the failed state's Try again) */
  retry: () => void;
}

/**
 * The watch page's related-videos shelf. Started alongside the video details; the shelf is
 * related to the video, so it is not requested again when the auth state settles — only when
 * `videoId` changes or the viewer asks to retry a failed shelf.
 */
export function useRelatedVideos(videoId: string): RelatedShelf {
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [status, setStatus] = useState<RelatedShelfStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    let cancelled = false;
    setVideos([]);
    setStatus('loading');
    fetchRelatedVideos(videoId)
      .then((loaded) => {
        if (cancelled) return;
        setVideos(loaded);
        setStatus('ready');
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
