'use client';

import { useState } from 'react';
import Link from '@/components/AppLink';
import { useRouter } from 'next/navigation';
import { retryMediaJobs } from '@/lib/api/admin';
import type { MediaJob } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, linkClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { deliveryFormats } from './format';
import { JOB_STATUS_LABEL, jobSeconds } from './metrics';

const thClass = 'text-start px-3 py-3 text-fg-muted font-medium whitespace-nowrap';
const tdClass = 'px-3 py-3 align-top text-sm';

const statusChip: Record<string, string> = {
  queued: 'bg-chip-pending-bg text-chip-pending-fg',
  transcoding: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
  ready: 'bg-chip-resolved-bg text-chip-resolved-fg',
  failed: 'bg-danger-bg text-danger-fg',
};

/** Recent R2 transcodes; a failed one has "Transcode again" (admin-api, audited per video). */
export function JobsTable({ jobs }: { jobs: MediaJob[] }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const f = deliveryFormats(locale);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function retry(id: string) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const result = await retryMediaJobs([id]);
      if (!result.ok) {
        logger.warn('[delivery] Transcode again failed', { status: result.status });
        setError(result.status === 401 ? t('errors.notAuthenticated') : t('mediaDelivery.retryFailed'));
        return;
      }
      setNotice(t('mediaDelivery.retried', { video: id }));
      router.refresh();
    } catch (e) {
      logger.error('[delivery] Transcode again request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('mediaDelivery.retryFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <ErrorAlert testId="delivery-retry-error">{error}</ErrorAlert>}
      <p role="status" className="text-sm text-fg empty:hidden" data-testid="delivery-retry-notice">{notice}</p>
      <div className="bg-surface border border-border rounded-lg overflow-x-auto">
        <table className="w-full" data-testid="delivery-jobs">
          <caption className="sr-only">{t('mediaDelivery.jobsCaption')}</caption>
          <thead className="border-b border-border">
            <tr>
              <th className={thClass} scope="col">{t('mediaDelivery.colStatus')}</th>
              <th className={thClass} scope="col">{t('mediaDelivery.colVideo')}</th>
              <th className={thClass} scope="col">{t('mediaDelivery.colTime')}</th>
              <th className={thClass} scope="col">{t('mediaDelivery.colRungs')}</th>
              <th className={thClass} scope="col">{t('mediaDelivery.colContainer')}</th>
              <th className={thClass} scope="col">{t('mediaDelivery.colError')}</th>
              <th className={thClass} scope="col">{t('mediaDelivery.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const seconds = jobSeconds(job);
              return (
                <tr key={job.video_id} className="border-b border-border last:border-0" data-video-id={job.video_id} data-status={job.status}>
                  <td className={tdClass}>
                    <span className={`px-2 py-1 text-sm rounded font-medium whitespace-nowrap ${statusChip[job.status] ?? 'bg-chip-dismissed-bg text-chip-dismissed-fg'}`}>
                      {JOB_STATUS_LABEL[job.status] ? t(JOB_STATUS_LABEL[job.status]) : job.status}
                    </span>
                  </td>
                  <td className={tdClass}>
                    <Link href={`/videos/${encodeURIComponent(job.video_id)}`} className={`${linkClass} font-mono text-xs break-all`}>{job.video_id}</Link>
                  </td>
                  <td className={`${tdClass} tabular-nums whitespace-nowrap`}>{seconds === null ? '—' : f.duration(seconds)}</td>
                  <td className={tdClass}>{job.rungs ? job.rungs.split(',').join(', ') : '—'}</td>
                  <td className={`${tdClass} tabular-nums`}>{job.container_seconds == null ? '—' : f.integer(job.container_seconds)}</td>
                  <td className={`${tdClass} max-w-xs break-words text-danger-fg`}>{job.error ?? ''}</td>
                  <td className={tdClass}>
                    {job.status === 'failed' && (
                      <button
                        type="button"
                        className={`${secondaryButtonClass} !py-2 !px-3 text-sm disabled:opacity-60`}
                        disabled={busy !== null}
                        onClick={() => retry(job.video_id)}
                        data-testid="delivery-retry"
                      >
                        {busy === job.video_id ? t('mediaDelivery.retrying') : t('mediaDelivery.retry')}
                        <span className="sr-only"> {job.video_id}</span>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
