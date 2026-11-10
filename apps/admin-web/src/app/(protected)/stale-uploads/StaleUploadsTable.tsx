'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteStaleUploads, keepStaleUploads, retryStaleUploads } from '@/lib/api/admin';
import type { ActionResult } from '@/lib/api/errors';
import type { StaleUploadActionResult, StaleUploadItem } from '@/lib/api/types';
import type { Locale } from '@/i18n/config';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { STATE_LABEL, STATE_TONE, TYPE_LABEL, actionsFor, bunnyLabel, createdAt, formatAge } from './labels';

const thClass = 'text-start px-3 py-3 text-fg-muted font-medium whitespace-nowrap';
const tdClass = 'px-3 py-3 align-top text-sm';

/**
 * Stale uploads with their Bunny status and age. Delete now, Keep and Retry
 * apply to the selected rows; each goes through admin-api (permission +
 * audit) and queues the reaper's check in api-videos.
 */
export function StaleUploadsTable({ items, locale, now }: { items: StaleUploadItem[]; locale: Locale; now: number }) {
  const router = useRouter();
  const { t } = useLanguage();
  const ids = useId();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const chosen = items.filter((i) => selected.has(i.videoId));
  const allSelected = items.length > 0 && selected.size === items.length;
  const can = {
    delete: chosen.length > 0 && chosen.every((i) => actionsFor(i).delete),
    keep: chosen.length > 0 && chosen.every((i) => actionsFor(i).keep),
    retry: chosen.length > 0 && chosen.every((i) => actionsFor(i).retry),
  };

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run(name: string, action: (ids: string[]) => Promise<ActionResult<StaleUploadActionResult>>, done: MessageKey) {
    const list = chosen.map((i) => i.videoId);
    setBusy(name);
    setError(null);
    setNotice(null);
    let result: ActionResult<StaleUploadActionResult>;
    try {
      result = await action(list);
    } catch (e) {
      logger.error('[stale-uploads] Action request failed', { name, error: e instanceof Error ? e.message : String(e) });
      result = { ok: false, status: 0, error: 'request failed' };
    }
    setBusy(null);
    if (!result.ok) {
      logger.warn('[stale-uploads] Action failed', { name, status: result.status });
      setError(result.status === 401 ? t('errors.notAuthenticated') : t('staleUploads.actionFailed'));
      return;
    }
    setNotice(t(done, { count: list.length }));
    setSelected(new Set());
    router.refresh();
  }

  const deleteNow = () => {
    if (!window.confirm(t('staleUploads.confirmDelete', { count: chosen.length }))) return;
    void run('delete', deleteStaleUploads, 'staleUploads.queuedDelete');
  };

  if (items.length === 0) {
    return <div className={`${cardClass} text-center text-fg-muted`} data-testid="stale-empty">{t('staleUploads.empty')}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3" role="toolbar" aria-label={t('staleUploads.tableCaption')}>
        <span className="text-sm text-fg-muted tabular-nums" aria-live="polite">{t('staleUploads.selected', { count: chosen.length })}</span>
        <button type="button" onClick={deleteNow} disabled={!can.delete || busy !== null} className={`${primaryButtonClass} disabled:opacity-50`} data-testid="stale-delete">
          {t('staleUploads.deleteNow')}
        </button>
        <button type="button" onClick={() => run('keep', keepStaleUploads, 'staleUploads.queuedKeep')} disabled={!can.keep || busy !== null} className={`${secondaryButtonClass} disabled:opacity-50`} data-testid="stale-keep">
          {t('staleUploads.keep')}
        </button>
        <button type="button" onClick={() => run('retry', retryStaleUploads, 'staleUploads.queuedRetry')} disabled={!can.retry || busy !== null} className={`${secondaryButtonClass} disabled:opacity-50`} data-testid="stale-retry">
          {t('staleUploads.retry')}
        </button>
      </div>
      {error && <ErrorAlert testId="stale-action-error">{error}</ErrorAlert>}
      {notice && <p role="status" className="text-success-fg text-sm">{notice}</p>}

      <div className="bg-surface border border-border rounded-lg overflow-x-auto">
        <table className="w-full" data-testid="stale-table">
          <caption className="sr-only">{t('staleUploads.tableCaption')}</caption>
          <thead className="border-b border-border">
            <tr>
              <th className={thClass} scope="col">
                <input
                  type="checkbox"
                  id={`${ids}-all`}
                  aria-label={t('staleUploads.selectAll')}
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.videoId)))}
                  className="h-4 w-4 accent-accent"
                />
              </th>
              <th className={thClass} scope="col">{t('staleUploads.colVideo')}</th>
              <th className={thClass} scope="col">{t('staleUploads.colType')}</th>
              <th className={thClass} scope="col">{t('staleUploads.colBunny')}</th>
              <th className={thClass} scope="col">{t('staleUploads.colAge')}</th>
              <th className={thClass} scope="col">{t('staleUploads.colActivity')}</th>
              <th className={thClass} scope="col">{t('staleUploads.colState')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const title = item.record?.title || item.bunny?.title || item.videoId;
              const activity = item.record?.lastActivityAt;
              return (
                <tr key={item.videoId} className="border-b border-border last:border-0" data-video-id={item.videoId} data-status={item.status}>
                  <td className={tdClass}>
                    <input
                      type="checkbox"
                      aria-label={t('staleUploads.selectRow', { title })}
                      checked={selected.has(item.videoId)}
                      onChange={() => toggle(item.videoId)}
                      className="h-4 w-4 accent-accent"
                    />
                  </td>
                  <td className={tdClass}>
                    <div className="font-medium text-fg" dir="auto">{title}</div>
                    <div className="text-fg-subtle text-xs" dir="ltr">{item.videoId}</div>
                  </td>
                  <td className={tdClass}>{t(TYPE_LABEL[item.target])}</td>
                  <td className={tdClass}>
                    <div>{bunnyLabel(t, item.bunny)}</div>
                    {typeof item.offset?.value === 'number' && <div className="text-fg-subtle text-xs tabular-nums" dir="ltr">{item.offset.value.toLocaleString(locale)} B</div>}
                  </td>
                  <td className={`${tdClass} tabular-nums`} title={createdAt(item) ? formatDate(createdAt(item)!, locale, true) : undefined}>
                    {formatAge(t, createdAt(item), now)}
                  </td>
                  <td className={tdClass}>{activity ? formatDate(activity, locale, true) : t('staleUploads.unknown')}</td>
                  <td className={tdClass}>
                    <span className={`px-2 py-1 text-sm rounded font-medium whitespace-nowrap ${STATE_TONE[item.status]}`} data-testid="stale-state">
                      {t(STATE_LABEL[item.status])}
                    </span>
                    {item.reason && <div className="text-fg-muted text-xs mt-1 max-w-xs" dir="auto">{item.reason}</div>}
                    {item.status === 'checking' && item.nextCheckAt && (
                      <div className="text-fg-subtle text-xs mt-1">{t('staleUploads.nextCheck', { date: formatDate(item.nextCheckAt, locale, true) })}</div>
                    )}
                    {item.status === 'kept' && item.keptBy && <div className="text-fg-subtle text-xs mt-1" dir="auto">{t('staleUploads.keptBy', { actor: item.keptBy })}</div>}
                    {item.lastError && (
                      <div className="text-danger-fg text-xs mt-1 max-w-xs">{t('staleUploads.attempts', { count: item.attempts ?? 0, error: item.lastError })}</div>
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
