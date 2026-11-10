'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { getVideoUploadStatusApi } from '@/lib/api/videos';
import { logger } from '@/lib/logger-client';

export const PROGRESS_POLL_MS = 15_000;

/**
 * Live encode progress of one of the owner's processing videos (studio).
 * Polls the owner's upload-status endpoint, which also moves the record to
 * ready when Bunny is done, and reports the final status once.
 */
export function ProcessingProgress({
  videoId,
  channelId,
  onSettled,
}: {
  videoId: string;
  channelId: string;
  onSettled?: (status: 'ready' | 'failed') => void;
}) {
  const { t } = useLanguage();
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const status = await getVideoUploadStatusApi(videoId, { channelId });
        const result = status?.result;
        if (cancelled || !result) return;
        if (result.status === 'ready' || result.status === 'failed') {
          onSettled?.(result.status);
          return;
        }
        setProgress(Math.round(result.encodingStatus?.encodingProgress ?? result.progress));
      } catch (error) {
        logger.warn('[ProcessingProgress] Status check failed; trying again', { videoId, error });
      }
    };
    void check();
    const timer = setInterval(check, PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [videoId, channelId, onSettled]);

  if (progress === null) return null;
  return (
    <span
      data-testid="dashboard-video-progress"
      data-progress={progress}
      className="inline-block px-2 py-1 rounded text-xs font-medium bg-muted text-muted-foreground"
    >
      {t.video.processingProgress.replace('{progress}', String(progress))}
    </span>
  );
}
