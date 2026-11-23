'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VideoInfo } from '@/interfaces';
import { fetchRelatedVideos } from '@/lib/api/videos';
import { logger } from '@/lib/logger-client';

export function useRelatedVideos(videoId: string) {
  const [relatedVideos, setRelatedVideos] = useState<VideoInfo[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(true);
  const [relatedFailed, setRelatedFailed] = useState(false);
  const [relatedAttempt, setRelatedAttempt] = useState(0);
  const retryRelated = useCallback(() => setRelatedAttempt((attempt) => attempt + 1), []);

  useEffect(() => {
    let cancelled = false;
    setRelatedVideos([]);
    setRelatedLoading(true);
    setRelatedFailed(false);

    fetchRelatedVideos(videoId)
      .then((videos) => {
        if (!cancelled) setRelatedVideos(videos);
      })
      .catch((error) => {
        if (cancelled) return;
        logger.warn('[WatchPage] Related videos failed to load', { videoId, error });
        setRelatedFailed(true);
      })
      .finally(() => {
        if (!cancelled) setRelatedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [videoId, relatedAttempt]);

  return { relatedVideos, relatedLoading, relatedFailed, retryRelated };
}
