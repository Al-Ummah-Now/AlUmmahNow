'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VideoFailure } from '@al-ummah/shared-types';
import { markProcessingFailed, syncProcessing } from '@/lib/api/admin';
import { retryFailed } from '@/lib/retry-failed';
import { resolutionsLabel } from '@/lib/resolution-label';
import { FailureWhy } from '@/components/content/failure';
import { useRetryConfirm } from '@/components/content/failure-retry';
import { R2Badge } from '@/components/content/r2';
import type { ActionResult } from '@/lib/api/errors';
import type { ProcessingVideoRow, SyncPreview } from '@/lib/api/types';
import type { Locale } from '@/i18n/config';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { ISSUE_LABEL, OUTCOME_LABEL, bunnyLabel, checkLabel, ourStatusLabel } from './labels';

import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
import { Sep } from '@/components/Sep';
const thClass = 'text-start px-3 py-3 text-fg-muted font-medium whitespace-nowrap';
const tdClass = 'px-3 py-3 align-top text-sm';

/**
 * Stuck and failed uploads with Bunny's and R2's state next to ours, why and what to do. Sync from Bunny always
 * shows a dry-run preview first; applying, Retry and Mark failed go through
 * admin-api (permission + audit) and queue the work in api-videos.
 */
export function ProcessingTable({ rows, failures }: { rows: ProcessingVideoRow[]; /** Why the failed ones failed, by id */ failures: Readonly<Record<string, VideoFailure>>; locale: Locale }) {
  const router = useRouter();
  const { t } = useLanguage();
  const ids = useId();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<SyncPreview[] | null>(null);
  const [reason, setReason] = useState('');

  const { mayRetry, dialog } = useRetryConfirm(failures);
  const chosen = [...selected];
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const titleOf = (id: string) => rows.find((r) => r.id === id)?.title || id;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run<T>(name: string, action: () => Promise<ActionResult<T>>, done: (data: T) => void) {
    setBusy(name);
    setError(null);
    setNotice(null);
    let result: ActionResult<T>;
    try {
      result = await action();
    } catch (e) {
      logger.error('[processing] Action request failed', { name, error: e instanceof Error ? e.message : String(e) });
      result = { ok: false, status: 0, error: 'request failed' };
    }
    setBusy(null);
    if (!result.ok) {
      logger.warn('[processing] Action failed', { name, status: result.status });
      setError(result.status === 401 ? t('errors.notAuthenticated') : t('processing.failed'));
      return;
    }
    done(result.data);
  }

  const startPreview = () =>
    run('preview', () => syncProcessing(chosen, true), (data) => setPreview(data.results));

  const applySync = () =>
    run('sync', () => syncProcessing(chosen, false), () => {
      setPreview(null);
      setNotice(t('processing.queued', { count: chosen.length }));
      setSelected(new Set());
      router.refresh();
    });

  const retry = async () =>
    (await mayRetry(chosen)) &&
    run('retry', () => retryFailed(chosen, failures, new Set(rows.filter((r) => r.r2Status === 'failed').map((r) => r.id))), () => {
      setNotice(t('processing.retried', { count: chosen.length }));
      setSelected(new Set());
      router.refresh();
    });

  const markFailed = () =>
    run('markFailed', () => markProcessingFailed(chosen, reason.trim() || undefined), () => {
      setNotice(t('processing.markedFailed', { count: chosen.length }));
      setSelected(new Set());
      setReason('');
      router.refresh();
    });

  function outcomeText(p: SyncPreview): string {
    if (p.error) return t('processing.failed');
    const plan = p.plan;
    if (!plan) return t('processing.bunnyUnknown');
    const noChange = Object.keys(plan.patch ?? {}).length === 0 && (plan.unset ?? []).length === 0;
    if (noChange && plan.outcome !== 'pending') return t('processing.outcomeNoChange');
    return OUTCOME_LABEL[plan.outcome] ? t(OUTCOME_LABEL[plan.outcome]) : plan.outcome;
  }

  return (
    <div className="space-y-4">
      {dialog}
      {error && <ErrorAlert testId="processing-action-error">{error}</ErrorAlert>}
      {notice && (
        <p role="status" className="rounded border border-border bg-surface-2 px-4 py-3 text-fg" data-testid="processing-notice">
          {notice}
        </p>
      )}

      <div className={`${cardClass} flex flex-wrap items-end gap-2`} data-testid="processing-actions">
        <span className="text-sm text-fg-muted me-2" aria-live="polite">{t('processing.selected', { count: selected.size })}</span>
        <button type="button" className={primaryButtonClass} disabled={!chosen.length || !!busy} onClick={startPreview} data-testid="processing-sync">
          {t('processing.sync')}
        </button>
        <button type="button" className={secondaryButtonClass} disabled={!chosen.length || !!busy} onClick={retry} data-testid="processing-retry">
          {t('processing.retry')}
        </button>
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          {t('processing.markFailedReason')}
          <input className={fieldClass} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="button" className={secondaryButtonClass} disabled={!chosen.length || !!busy} onClick={markFailed} data-testid="processing-mark-failed">
          {t('processing.markFailed')}
        </button>
      </div>

      {preview && (
        <section className={cardClass} aria-labelledby={`${ids}-preview`} data-testid="processing-preview">
          <h2 id={`${ids}-preview`} className="text-lg font-semibold text-fg mb-2">{t('processing.previewTitle')}</h2>
          <p className="text-fg-muted text-sm mb-3">{t('processing.previewIntro')}</p>
          <ul className="space-y-1 mb-4">
            {preview.map((p) => (
              <li key={p.videoId} className="text-sm text-fg" data-video-id={p.videoId} data-outcome={p.plan?.outcome ?? 'error'}>
                <span className="font-medium">{titleOf(p.videoId)}</span>
                <Sep />
                {bunnyLabel(t, p.bunny)}
                {' → '}
                {outcomeText(p)}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" className={primaryButtonClass} disabled={!!busy} onClick={applySync} data-testid="processing-apply">
              {t('processing.previewApply')}
            </button>
            <button type="button" className={secondaryButtonClass} disabled={!!busy} onClick={() => setPreview(null)}>
              {t('processing.previewCancel')}
            </button>
          </div>
        </section>
      )}

      <div className="bg-surface border border-border rounded-lg overflow-x-auto">
        <table className="w-full" data-testid="processing-table">
          <caption className="sr-only">{t('processing.tableCaption')}</caption>
          <thead className="border-b border-border">
            <tr>
              <th className={thClass} scope="col">
                <input
                  type="checkbox"
                  aria-label={t('processing.selectAll')}
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              <th className={thClass} scope="col">{t('processing.colVideoWhy')}</th>
              <th className={thClass} scope="col">{t('processing.colOurs')}</th>
              <th className={thClass} scope="col">{t('processing.colBunny')}</th>
              <th className={thClass} scope="col">{t('processing.colR2')}</th>
              <th className={thClass} scope="col">{t('processing.colCheck')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0" data-video-id={row.id} data-status={row.uploadStatus ?? 'ready'}>
                <td className={tdClass}>
                  <input
                    type="checkbox"
                    aria-label={t('processing.selectVideo', { title: row.title || row.id })}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                </td>
                <td className={`${tdClass} min-w-[17rem]`}>
                  <div className="font-medium text-fg"><bdi>{row.title || row.id}</bdi></div>
                  <div className="text-fg-muted text-xs"><bdi dir="ltr">{row.id}</bdi></div>
                  {row.dateCreated && <div className="text-fg-muted text-xs">{fillNodes(t('processing.created'), { date: <LocalTime value={row.dateCreated} withTime /> })}</div>}
                  {failures[row.id] ? (
                    <FailureWhy failure={failures[row.id]} t={t} className="mt-2" />
                  ) : (
                    row.processingIssue && <div className="mt-1 text-fg font-medium">{t(ISSUE_LABEL[row.processingIssue.kind])}</div>
                  )}
                </td>
                <td className={tdClass}>
                  <div className="text-fg">{ourStatusLabel(t, row.uploadStatus)}</div>
                  <div className="text-fg-muted text-xs">{t('processing.resolutions', { count: row.availableResolutions.length })}</div>
                </td>
                <td className={tdClass} data-bunny-status={row.bunny === null ? 'missing' : row.bunny?.status ?? ''}>
                  <div className="text-fg">{bunnyLabel(t, row.bunny)}</div>
                  {row.bunny?.availableResolutions && (
                    <div className="text-fg-muted text-xs">{resolutionsLabel(row.bunny.availableResolutions, t)}</div>
                  )}
                </td>
                <td className={tdClass} data-r2-status={row.r2Status ?? 'none'}>
                  {row.r2Status !== undefined && <R2Badge r2={row.r2Status ? { status: row.r2Status as 'failed' } : null} t={t} prefix={false} />}
                </td>
                <td className={tdClass}>
                  {/* The next check time goes in as <LocalTime> (local with zone, UTC on hover) */}
                  {fillNodes(checkLabel(t, row.processingCheck, () => '{date}'), {
                    date: row.processingCheck?.nextCheckAt ? <LocalTime value={row.processingCheck.nextCheckAt} withTime /> : '',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
