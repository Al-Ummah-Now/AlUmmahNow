'use client';

import { useCallback, useEffect, useState } from 'react';
import type { VideoInfo } from '@/interfaces';
import { fetchRelatedVideos } from '@/lib/api/videos';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';

/**
 * Where the watch page's related shelf is (#1552):
 * - loading: requested, no answer yet (skeleton)
 * - failed: no source could be reached; the viewer can try again
 * - empty: the API answered with nothing related; the shelf is hidden, never an error
 * - loaded: videos to list
 */
export type RelatedShelfStatus = 'loading' | 'failed' | 'empty' | 'loaded';

export interface RelatedVideosState {
  videos: VideoInfo[];
  status: RelatedShelfStatus;
  /** Request the shelf again (the failed state's "Try again"). */
  retry: () => void;
}

/**
 * The related videos of `videoId`, requested when the video changes or the viewer retries. The
 * shelf belongs to the video, so it is not requested again when the auth state settles.
 */
export function useRelatedVideos(videoId: string): RelatedVideosState {
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [status, setStatus] = useState<RelatedShelfStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setVideos([]);
    setStatus('loading');
    fetchRelatedVideos(videoId).then(
      (list) => {
        if (cancelled) return;
        setVideos(list);
        setStatus(list.length > 0 ? 'loaded' : 'empty');
        // An empty answer is normal (a channel's only video, a new site), not a problem to report
        if (list.length === 0) logger.debug('[useRelatedVideos] No related videos', { videoId });
      },
      (error: unknown) => {
        if (cancelled) return;
        // The viewer sees this failure ("couldn't load… Try again"), so it reaches the Errors page
        reportError(error, { shown: true, extra: { step: 'related-videos', videoId, attempt } });
        setStatus('failed');
      },
    );
    return () => {
      cancelled = true;
    };
    // attempt is the retry trigger
  }, [videoId, attempt]);

  return { videos, status, retry };
}
