'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { retryThumbnailRun, startThumbnailRepair } from '@/lib/api/admin';
import type { ActionResult } from '@/lib/api/errors';
import type { ThumbnailRun } from '@/lib/api/types';
import type { Locale } from '@/i18n/config';
import { useLanguage } from '@/i18n/I18nProvider';
import { useConfirm } from '@/components/content/actions';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, cardClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { RUN_STATUS_LABEL, THUMB_OUTCOME_LABEL, thumbCounts } from './labels';

const thClass = 'text-start px-3 py-2 text-fg-muted font-medium whitespace-nowrap';
const tdClass = 'px-3 py-2 align-top text-sm';

/**
 * Thumbnail shapes: queues the thumbnail aspect repair job (api-videos
 * lib/thumbnail/repair.ts). "Check" is a dry run that only reports; "Fix"
 * replaces auto frames captured at the wrong shape with Bunny's thumbnail.
 * The job runs in the admin-jobs queue with retries; a failed run shows
 * Retry here and is listed on the Errors page.
 */
export function ThumbnailRepairPanel({ runs, locale }: { runs: ThumbnailRun[] | null; locale: Locale }) {
  const router = useRouter();
  const { t } = useLanguage();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = runs?.[0] ?? null;
  const active = latest ? ['queued', 'running', 'retrying'].includes(latest.status) : false;

  async function run(name: string, action: () => Promise<ActionResult<unknown>>, message: string) {
    setBusy(name);
    setError(null);
    setNotice(null);
    let result: ActionResult<unknown>;
    try {
      result = await action();
    } catch (e) {
      logger.error('[processing] Thumbnail action request failed', { name, error: e instanceof Error ? e.message : String(e) });
      result = { ok: false, status: 0, error: 'request failed' };
    }
    setBusy(null);
    if (!result.ok) {
      logger.warn('[processing] Thumbnail action failed', { name, status: result.status });
      setError(result.status === 401 ? t('errors.notAuthenticated') : t('processing.failed'));
      return;
    }
    setNotice(message);
    router.refresh();
  }

  const fix = async () => {
    const confirmed = await confirm({
      title: t('confirmDialog.thumbsFixTitle'),
      body: t('processing.thumbsFixConfirm'),
      confirmLabel: t('processing.thumbsFix'),
      testId: 'thumbnail-fix-confirm',
    });
    if (!confirmed) return;
    void run('fix', () => startThumbnailRepair(false), t('processing.thumbsQueued'));
  };

  const result = latest?.result ?? null;
  const items = result?.items ?? [];

  return (
    <section className={`${cardClass} mb-6`} data-testid="thumbnail-repair" aria-labelledby="thumbs-title">
      {confirmDialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="thumbs-title" className="text-lg font-semibold text-fg mb-1">{t('processing.thumbsTitle')}</h2>
          <p className="text-fg-muted text-sm">{t('processing.thumbsIntro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy !== null || active}
            onClick={() => void run('check', () => startThumbnailRepair(true), t('processing.thumbsQueued'))}
            data-testid="thumbnail-check"
          >
            {t('processing.thumbsCheck')}
          </button>
          <button type="button" className={primaryButtonClass} disabled={busy !== null || active} onClick={fix} data-testid="thumbnail-fix">
            {t('processing.thumbsFix')}
          </button>
        </div>
      </div>

      {error && <div className="mt-3"><ErrorAlert testId="thumbnail-error">{error}</ErrorAlert></div>}
      {notice && <p className="mt-3 text-sm text-fg" role="status" data-testid="thumbnail-notice">{notice}</p>}
      {runs === null && <p className="mt-3 text-sm text-fg-muted">{t('processing.thumbsLoadFailed')}</p>}
      {runs !== null && !latest && <p className="mt-3 text-sm text-fg-muted" data-testid="thumbnail-never">{t('processing.thumbsNever')}</p>}

      {latest && (
        <div className="mt-4 space-y-2" data-testid="thumbnail-latest" data-run-id={latest.id} data-status={latest.status}>
          <p className="text-sm text-fg">
            {t('processing.thumbsRun', {
              mode: t(latest.params.dryRun === false ? 'processing.thumbsModeFix' : 'processing.thumbsModeCheck'),
              date: formatDate(latest.createdAt, locale, true),
              status: t(RUN_STATUS_LABEL[latest.status]),
            })}
            {result?.checked !== undefined && <> · {t('processing.thumbsChecked', { count: result.checked })}</>}
          </p>
          {thumbCounts(t, result?.counts) && <p className="text-sm text-fg-muted">{thumbCounts(t, result?.counts)}</p>}
          {latest.status === 'failed' && (
            <div className="flex flex-wrap items-center gap-3">
              {latest.lastError && <p className="text-sm text-fg-muted">{t('processing.thumbsError', { error: latest.lastError })}</p>}
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={busy !== null}
                onClick={() => void run('retry', () => retryThumbnailRun(latest.id), t('processing.thumbsRetried'))}
                data-testid="thumbnail-retry"
              >
                {t('processing.thumbsRetry')}
              </button>
            </div>
          )}
          {active && (
            <button type="button" className={secondaryButtonClass} onClick={() => router.refresh()}>
              {t('processing.thumbsRefresh')}
            </button>
          )}
          {items.length > 0 && (
            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="thumbnail-items">
                <caption className="sr-only">{t('processing.thumbsCaption')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('processing.thumbsColVideo')}</th>
                    <th className={thClass} scope="col">{t('processing.thumbsColOutcome')}</th>
                    <th className={thClass} scope="col">{t('processing.thumbsColReason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.videoId} className="border-b border-border last:border-0" data-video-id={item.videoId} data-outcome={item.outcome}>
                      <td className={tdClass} dir="ltr">{item.videoId}</td>
                      <td className={tdClass}>{t(THUMB_OUTCOME_LABEL[item.outcome])}</td>
                      <td className={`${tdClass} text-fg-muted`}>{item.reason ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
