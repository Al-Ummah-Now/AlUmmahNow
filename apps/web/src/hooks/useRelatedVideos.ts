'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VideoInfo } from '@/interfaces';
import { fetchRelatedVideos } from '@/lib/api/videos';
import { logger } from '@/lib/logger-client';

export type RelatedVideosStatus = 'loading' | 'loaded' | 'empty' | 'failed';

interface RelatedVideosState {
  status: RelatedVideosStatus;
  videos: VideoInfo[];
}

export interface UseRelatedVideosResult {
  status: RelatedVideosStatus;
  videos: VideoInfo[];
  loading: boolean;
  failed: boolean;
  retry: () => void;
}

/**
 * Loads the watch page's related-videos shelf and distinguishes a load failure
 * from a successful empty response. Scoped to `videoId` and explicit retries
 * so auth state settling does not trigger duplicate requests.
 */
export function useRelatedVideos(videoId: string): UseRelatedVideosResult {
  const [state, setState] = useState<RelatedVideosState>({ status: 'loading', videos: [] });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((prev) => prev + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', videos: [] });
    fetchRelatedVideos(videoId)
      .then((videos) => {
        if (cancelled) return;
        setState({ status: videos.length > 0 ? 'loaded' : 'empty', videos });
      })
      .catch((error) => {
        logger.warn('[WatchPage] Related videos failed to load', { videoId, error });
        if (cancelled) return;
        setState({ status: 'failed', videos: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [videoId, attempt]);

  return {
    status: state.status,
    videos: state.videos,
    loading: state.status === 'loading',
    failed: state.status === 'failed',
    retry,
  };
}
