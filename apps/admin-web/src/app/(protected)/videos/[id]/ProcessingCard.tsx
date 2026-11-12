'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminLiveUpdate } from '@al-ummah/shared-types';
import type { AdminVideoR2, VideoDetailView } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { useAdminLive } from '@/lib/live/useAdminLive';
import { BunnySource, bunnyInProgress, r2FromLiveEvent, r2InProgress } from '@/components/content/processing';
import { VideoR2Panel } from './VideoR2Panel';

/** While the socket is down: re-read the video this often (useAdminLive's poll). */
export const R2_POLL_MS = 30_000;
/** Bunny's progress is not on the live channel: re-read this often while it encodes. */
export const BUNNY_POLL_MS = 10_000;

/**
 * The two sources of the Processing card side by side. R2 follows
 * the admin:media live channel: a `job` event for this video patches the
 * status, attempt, progress and rung chips at once; a cut (truncated) event,
 * a resync, or a finish re-reads the video. Bunny is re-read every 10 s while
 * it encodes. Nothing runs once both sources are finished or failed.
 */
export function ProcessingCard({
  videoId,
  processing,
  processingIssue,
  fallbackResolutions,
  r2: serverR2,
  canManage,
}: {
  videoId: string;
  processing: VideoDetailView['processing'];
  processingIssue?: VideoDetailView['processingIssue'];
  fallbackResolutions: string[];
  /** undefined: an older api-videos without the R2 state */
  r2: AdminVideoR2 | null | undefined;
  canManage: boolean;
}) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const refetch = useCallback(() => router.refresh(), [router]);
  const [r2, setR2] = useState(serverR2);
  const r2Ref = useRef(r2);
  r2Ref.current = r2;
  // A re-read brings the server's state: it replaces whatever live events patched
  useEffect(() => setR2(serverR2), [serverR2]);

  const onUpdate = useCallback(
    (update: AdminLiveUpdate) => {
      if (update.resync) return refetch();
      const mine = update.events.filter((e) => e.kind === 'job' && e.key === `job:${videoId}`);
      if (!mine.length) return;
      let next = r2Ref.current;
      let again = false;
      for (const e of mine) {
        const step = r2FromLiveEvent(next, e);
        next = step.r2;
        again ||= step.refetch;
      }
      setR2(next);
      if (again) refetch();
    },
    [refetch, videoId],
  );
  useAdminLive(['media'], onUpdate, { poll: refetch, pollMs: R2_POLL_MS, enabled: r2InProgress(r2) });

  const bunnyBusy = bunnyInProgress(processing, processingIssue);
  useEffect(() => {
    if (!bunnyBusy) return;
    const timer = window.setInterval(refetch, BUNNY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [bunnyBusy, refetch]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <section aria-labelledby="processing-bunny-title" data-testid="processing-bunny">
        <h3 id="processing-bunny-title" className="text-base font-semibold text-fg mb-2">{t('videos.processingBunnyTitle')}</h3>
        <BunnySource processing={processing} issue={processingIssue} fallbackResolutions={fallbackResolutions} t={t} locale={locale} />
      </section>
      <section aria-labelledby="processing-r2-title" data-testid="video-r2-section">
        <h3 id="processing-r2-title" className="text-base font-semibold text-fg mb-2">{t('mediaDelivery.r2Title')}</h3>
        {r2 === undefined ? (
          <p className="text-sm text-fg-muted">{t('mediaDelivery.r2Unavailable')}</p>
        ) : (
          <VideoR2Panel videoId={videoId} r2={r2} canManage={canManage} />
        )}
      </section>
    </div>
  );
}
