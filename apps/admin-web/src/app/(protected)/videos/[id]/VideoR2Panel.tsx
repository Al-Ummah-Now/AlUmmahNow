'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { retryMediaJobs } from '@/lib/api/admin';
import type { AdminVideoR2 } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { useConfirm } from '@/components/content/actions';
import { ErrorAlert, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { R2Status } from '@/components/content/r2';
import { logger } from '@/lib/logger-client';

interface RetryResult {
  results?: { videoId: string; queued?: boolean; why?: string }[];
}

/**
 * The R2 side of the video page (epic #687): the badge, progress, error and
 * failure details, and "Transcode again" (admin-api POST /api/media/retry,
 * media:manage, audited per video). A failed video retries at once; a ready
 * one, or one never transcoded, asks first in the in-app dialog because it
 * uses container time.
 */
export function VideoR2Panel({ videoId, r2, canManage }: { videoId: string; r2: AdminVideoR2 | null; canManage: boolean }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function transcode() {
    setError(null);
    setNotice(null);
    if (r2?.status !== 'failed') {
      const ok = await confirm({
        title: r2 ? t('mediaDelivery.r2ConfirmTitle') : t('mediaDelivery.r2ConfirmNoneTitle'),
        body: r2 ? t('mediaDelivery.r2ConfirmBody') : t('mediaDelivery.r2ConfirmNoneBody'),
        confirmLabel: r2 ? t('mediaDelivery.retry') : t('mediaDelivery.r2Transcode'),
        testId: 'video-r2-confirm',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const result = await retryMediaJobs([videoId]);
      if (!result.ok) {
        logger.warn('[videos] Transcode again failed', { status: result.status });
        setError(result.status === 401 ? t('errors.notAuthenticated') : t('mediaDelivery.retryFailed'));
        return;
      }
      const mine = (result.data as RetryResult | undefined)?.results?.find((r) => r.videoId === videoId);
      if (mine && mine.queued === false) {
        setError(t('mediaDelivery.r2NotQueued', { why: mine.why ?? '' }));
        return;
      }
      setNotice(t('mediaDelivery.r2Queued'));
      router.refresh();
    } catch (e) {
      logger.error('[videos] Transcode again request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('mediaDelivery.retryFailed'));
    } finally {
      setBusy(false);
    }
  }

  const failed = r2?.status === 'failed';
  const label = r2 ? t('mediaDelivery.retry') : t('mediaDelivery.r2Transcode');
  return (
    <div data-testid="video-r2">
      <R2Status r2={r2} t={t} locale={locale} />
      {canManage && (
        <div className="mt-3 flex flex-col items-start gap-2">
          <button
            type="button"
            className={`${failed ? primaryButtonClass : secondaryButtonClass} !py-2 !px-3 text-sm disabled:opacity-60`}
            disabled={busy}
            aria-busy={busy}
            onClick={transcode}
            data-testid="video-r2-retry"
          >
            {busy ? t('mediaDelivery.retrying') : label}
          </button>
          {error && <ErrorAlert testId="video-r2-error">{error}</ErrorAlert>}
          <p role="status" className="text-sm text-fg empty:hidden" data-testid="video-r2-notice">{notice}</p>
        </div>
      )}
      {dialog}
    </div>
  );
}
