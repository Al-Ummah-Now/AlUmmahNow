'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, VideoOff } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { fetchVideoById, getVideoUploadStatusApi } from '@/lib/api/videos';
import { isVideoProcessing, type PlayerOptions } from '@/components/VideoPagePlayer/interface';
import { logger } from '@/lib/logger-client';

/** How often the page checks again while the video is processing */
export const PROCESSING_POLL_MS = 15_000;

interface Props {
  video: PlayerOptions;
  /** The signed-in viewer uploaded this video (sees progress and the re-upload link) */
  isOwner: boolean;
  /** Called with the fresh details once the video can play */
  onReady: (video: PlayerOptions) => void;
}

/**
 * Shown on the watch page instead of the player while a video is still
 * uploading or processing ("Processing, ready soon"), or when processing
 * failed. Never a raw player error: the playlist does not exist yet, so the
 * player is not loaded at all. Checks again every 15 s and swaps in the
 * player as soon as the video is ready. The owner also sees Bunny's encode
 * progress (their status endpoint) and, on failure, a link to upload again.
 */
export function VideoProcessingState({ video, isOwner, onReady }: Props) {
  const { t, lang, isRTL } = useLanguage();
  const [progress, setProgress] = useState<number | null>(null);
  const [posterOk, setPosterOk] = useState(!!video.poster);
  const failed = video.uploadStatus === 'failed';

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    const check = async () => {
      try {
        if (isOwner && video.channelId) {
          // The owner's status endpoint also moves the record to ready when Bunny is done
          const status = await getVideoUploadStatusApi(video.id, { channelId: video.channelId });
          if (!cancelled && status?.result) setProgress(Math.round(status.result.encodingStatus?.encodingProgress ?? status.result.progress));
        }
        const fresh = await fetchVideoById(video.id);
        if (!cancelled && fresh && !isVideoProcessing(fresh)) {
          logger.debug('[VideoProcessingState] Video finished processing', { videoId: video.id, status: fresh.uploadStatus });
          onReady(fresh);
        }
      } catch (error) {
        logger.warn('[VideoProcessingState] Status check failed; trying again', { videoId: video.id, error });
      }
    };
    const timer = setInterval(check, PROCESSING_POLL_MS);
    if (isOwner) void check();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [video.id, video.channelId, isOwner, failed, onReady]);

  const title = failed ? t.video.processingFailedTitle : t.video.processingTitle;
  const description = failed
    ? isOwner
      ? t.video.processingFailedOwnerDescription
      : t.video.processingFailedDescription
    : t.video.processingDescription;

  return (
    <div
      className="relative w-full aspect-video overflow-hidden rounded-xl border border-border bg-muted"
      data-testid="video-processing-state"
      data-status={video.uploadStatus ?? 'processing'}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {posterOk && video.poster && (
        // The thumbnail may not exist until Bunny finishes: hide it on error and keep the placeholder
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={video.poster}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-40 blur-sm"
          onError={() => setPosterOk(false)}
          data-testid="video-processing-poster"
        />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-card-foreground bg-card/80">
        {failed ? (
          <VideoOff className="h-12 w-12 text-destructive" aria-hidden="true" />
        ) : (
          <Loader2 className="h-12 w-12 text-brand animate-spin motion-reduce:animate-none" aria-hidden="true" />
        )}
        <h2 className="text-xl font-semibold" role="status" aria-live="polite">
          {title}
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        {!failed && progress !== null && progress > 0 && progress < 100 && (
          <p className="text-sm font-medium" data-testid="video-processing-progress" data-progress={progress}>
            {t.video.processingProgress.replace('{progress}', String(progress))}
          </p>
        )}
        {failed && isOwner && (
          <Link
            href={`/${lang}/upload`}
            className="mt-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="video-processing-reupload"
          >
            {t.video.processingReupload}
          </Link>
        )}
      </div>
    </div>
  );
}
