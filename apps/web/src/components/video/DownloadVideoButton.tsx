'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useFeatures } from '@/hooks/useFeatures';
import { useLanguage } from '@/hooks/useLanguage';
import { requestWebVideoDownload } from '@/lib/downloads/download-client';

export interface DownloadVideoButtonProps {
  videoId: string;
  channelId?: string | null;
  allowDownloads?: boolean;
  isPublic?: boolean;
  isUnlisted?: boolean;
  isLive?: boolean;
  /** Non-empty when R2 progressive `video.mp4` is ready for public download */
  contentUrl?: string;
  onError?: (message: string | null) => void;
  /** Optional hook for triggering the browser save-as URL (injectable in unit tests) */
  triggerDownload?: (url: string) => void;
  className?: string;
}

type DownloadEligibility = Pick<
  DownloadVideoButtonProps,
  'allowDownloads' | 'isLive' | 'isPublic' | 'isUnlisted' | 'contentUrl'
>;

export function isWatchDownloadAvailable(video?: DownloadEligibility | null): boolean {
  return video?.allowDownloads === true &&
    video.isLive !== true &&
    video.isPublic !== false &&
    video.isUnlisted !== true &&
    Boolean(video.contentUrl);
}

function defaultTriggerDownload(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Plain Web Download button for the watch-page action row (Epic 14, E14-S6b / E14-D3 / E14-D6).
 *
 * - Completely hidden when signed out, when `offlineDownloads` is off, when the creator disabled
 *   downloads, when the video is non-public/unlisted/live, or when R2 progressive `video.mp4` is
 *   not ready (never Bunny).
 * - Calls `POST /api/v1/videos/:id/downloads` with `{ disposition: 'attachment' }` and downloads
 *   the plain MP4 via `/dl/<videoId>/<rev>/<filename>.mp4` (`Content-Disposition: attachment`).
 * - No encryption and no in-browser offline library.
 */
export function DownloadVideoButton({
  videoId,
  channelId,
  allowDownloads,
  isPublic,
  isUnlisted,
  isLive,
  contentUrl,
  onError,
  triggerDownload = defaultTriggerDownload,
  className = '',
}: DownloadVideoButtonProps) {
  const { user } = useAuth();
  const { features } = useFeatures(channelId ?? null);
  const { t, lang } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [previousVideoId, setPreviousVideoId] = useState(videoId);
  const requestRef = useRef<AbortController | null>(null);

  if (previousVideoId !== videoId) {
    setPreviousVideoId(videoId);
    setBusy(false);
    setStatusMessage('');
  }

  // Cancel at commit so an old request cannot trigger a download after navigation.
  useLayoutEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, [videoId]);

  const eligible =
    Boolean(user) &&
    features.offlineDownloads === true &&
    isWatchDownloadAvailable({ allowDownloads, isLive, isPublic, isUnlisted, contentUrl });

  if (!eligible) return null;

  const label = t.video.downloadVideo ?? 'Download';
  const busyLabel = t.video.downloadingVideo ?? 'Preparing download…';

  const handleClick = async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setStatusMessage('');
    onError?.(null);

    const res = await requestWebVideoDownload(videoId, { locale: lang, signal: controller.signal });
    if (controller.signal.aborted) return;

    requestRef.current = null;
    setBusy(false);

    if (res.ok) {
      setStatusMessage(t.video.downloadStarted ?? 'Download started');
      triggerDownload(res.url);
    } else {
      const msg = res.message || t.video.downloadFailed || 'Could not start download. Please try again.';
      setStatusMessage(msg);
      onError?.(msg);
    }
  };

  // The Watch action row supplies the shared pill styles.
  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        data-testid="watch-download-button"
        title={busy ? busyLabel : label}
        className={`inline-flex items-center gap-2 ${className}`.trim()}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="wa-label">{busy ? busyLabel : label}</span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </span>
    </>
  );
}

export default DownloadVideoButton;
