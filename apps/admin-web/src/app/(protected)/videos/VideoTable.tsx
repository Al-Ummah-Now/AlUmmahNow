'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteVideo, videoAction } from '@/lib/api/content';
import type { ActionResult } from '@/lib/api/errors';
import type { AdminContentPermission, AdminVideoRow } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, formatNumber, type MessageKey } from '@/i18n/translate';
import { linkClass } from '@/components/ui';
import { ConfirmButton } from '@/components/content/actions';
import { Chip, MonoId, smallButtonClass, statusTone, tableWrapClass, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { R2Badge } from '@/components/content/r2';
import { VideoBulkActionsSlot } from './extensions';

function duration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * The videos list with selection and a bulk bar: unpublish, republish and
 * delete (deletes are queued jobs), plus media repair from the extension slot.
 * Each bulk action runs per video and reports how many went through.
 */
export function VideoTable({ rows, permissions }: { rows: AdminVideoRow[]; permissions: AdminContentPermission[] }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: number; total: number } | null>(null);

  const canManage = permissions.includes('videos:manage');
  const canDelete = permissions.includes('content:delete');
  const selectable = canManage || canDelete;
  const chosen = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = rows.length > 0 && chosen.length === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulk(name: string, action: (id: string) => Promise<ActionResult<unknown>>) {
    setBusy(name);
    setResult(null);
    let ok = 0;
    for (const id of chosen) {
      try {
        if ((await action(id)).ok) ok++;
      } catch {
        // counted as not done
      }
    }
    setBusy(null);
    setResult({ ok, total: chosen.length });
    setSelected(new Set());
    router.refresh();
  }

  const statusLabel = (s: string | null) => (s ? t(`videos.statusLabels.${s}` as MessageKey) : t('content.none'));

  return (
    <div className="space-y-3">
      {selectable && (
        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-3" role="region" aria-label={t('videos.bulkActions')} data-testid="video-bulk-bar">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-fg-muted me-2" aria-live="polite" data-testid="video-selected-count">
              {t('videos.selected', { count: chosen.length })}
            </span>
            {canManage && (
              <>
                <button type="button" className={smallButtonClass} disabled={!chosen.length || !!busy} onClick={() => bulk('unpublish', (id) => videoAction(id, 'unpublish'))} data-testid="video-bulk-unpublish">
                  {busy === 'unpublish' ? t('content.working') : t('videos.bulkUnpublish')}
                </button>
                <button type="button" className={smallButtonClass} disabled={!chosen.length || !!busy} onClick={() => bulk('republish', (id) => videoAction(id, 'republish'))} data-testid="video-bulk-republish">
                  {busy === 'republish' ? t('content.working') : t('videos.bulkRepublish')}
                </button>
              </>
            )}
            {canDelete && (
              <ConfirmButton
                label={t('videos.bulkDelete')}
                title={t('videos.bulkDeleteTitle', { count: chosen.length })}
                body={t('videos.bulkDeleteBody')}
                confirmLabel={t('videos.bulkDelete')}
                withReason
                reasonHint={t('deleted.reasonHint')}
                danger
                disabled={!chosen.length || !!busy}
                busy={busy === 'delete'}
                testId="video-bulk-delete"
                onConfirm={(reason) => bulk('delete', (id) => deleteVideo(id, reason || undefined))}
              />
            )}
            {chosen.length > 0 && (
              <button type="button" className={`${linkClass} text-sm ms-auto`} onClick={() => setSelected(new Set())}>
                {t('videos.clearSelection')}
              </button>
            )}
          </div>
          <div data-slot="video-bulk-actions-extensions">
            <VideoBulkActionsSlot selectedIds={chosen} permissions={permissions} onDone={() => { setSelected(new Set()); router.refresh(); }} />
          </div>
          {result && (
            <p role="status" className={`text-sm ${result.ok === result.total ? 'text-success-fg' : 'text-danger-fg'}`} data-testid="video-bulk-result">
              {t('videos.bulkResult', { ok: result.ok, total: result.total })}
            </p>
          )}
        </div>
      )}

      <div className={tableWrapClass}>
        <table className="w-full" data-testid="videos-table">
          <caption className="sr-only">{t('videos.tableCaption')}</caption>
          <thead className="border-b border-border">
            <tr>
              {selectable && (
                <th className={`${thClass} w-10`} scope="col">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    aria-label={t('videos.selectAll')}
                    data-testid="video-select-all"
                  />
                </th>
              )}
              <th className={thClass} scope="col">{t('videos.colVideo')}</th>
              <th className={`${thClass} ${wideOnly}`} scope="col">{t('videos.colChannel')}</th>
              <th className={thClass} scope="col">{t('videos.colStatus')}</th>
              <th className={thClass} scope="col">{t('mediaDelivery.colR2')}</th>
              <th className={`${thClass} ${wideOnly} text-end`} scope="col">{t('videos.colViews')}</th>
              <th className={`${thClass} ${wideOnly}`} scope="col">{t('videos.colCreated')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const time = duration(v.duration);
              return (
                <tr key={v.id} className="border-b border-border last:border-0 hover:bg-surface-hover" data-testid="video-row" data-video-id={v.id} data-status={v.status ?? ''}>
                  {selectable && (
                    <td className={tdClass}>
                      <input type="checkbox" className="h-4 w-4 mt-1" checked={selected.has(v.id)} onChange={() => toggle(v.id)} aria-label={t('videos.selectVideo', { title: v.title })} data-testid="video-select" />
                    </td>
                  )}
                  <td className={tdClass}>
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="relative shrink-0">
                        {v.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- remote thumbnails from the images CDN
                          <img src={v.thumbnailUrl} alt="" className="h-12 w-20 sm:h-14 sm:w-24 rounded object-cover bg-surface-2" loading="lazy" />
                        ) : (
                          <span aria-hidden="true" className="block h-12 w-20 sm:h-14 sm:w-24 rounded bg-surface-2" />
                        )}
                        {time && <span className="absolute bottom-1 end-1 rounded bg-fg/80 px-1 text-[10px] text-surface tabular-nums" dir="ltr">{time}</span>}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/videos/${encodeURIComponent(v.id)}`} className={`${linkClass} font-medium break-words`} dir="auto" data-testid="video-link">
                          {v.title || v.id}
                        </Link>
                        <span className="block"><MonoId value={v.id} /></span>
                        <span className="block md:hidden text-xs text-fg-muted mt-1" dir="auto">
                          {v.channelName ?? (v.channelId ? v.channelId : t('content.noChannel'))} · {formatNumber(v.views, locale)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className={`${tdClass} ${wideOnly} text-sm`}>
                    {v.channelId ? (
                      <Link href={`/channels/${encodeURIComponent(v.channelId)}`} className={`${linkClass} break-words`} dir="auto">
                        {v.channelName || v.channelId}
                      </Link>
                    ) : (
                      <span className="text-fg-subtle">{t('content.noChannel')}</span>
                    )}
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-wrap gap-1">
                      <Chip tone={statusTone(v.status)} testId="chip-status">{statusLabel(v.status)}</Chip>
                      <Chip tone="neutral">{v.isPublic ? t('videos.public') : t('videos.private')}</Chip>
                      {v.isHidden && <Chip tone="bad" testId="chip-hidden">{t('videos.hiddenYes')}</Chip>}
                      {!!v.openReports && <Chip tone="warn" testId="chip-reports">{t('content.openReports', { count: v.openReports })}</Chip>}
                    </div>
                  </td>
                  <td className={tdClass} data-testid="video-r2-cell">
                    {/* Absent from an older api-videos: nothing rather than a wrong "Not transcoded" */}
                    {v.r2 !== undefined && <R2Badge r2={v.r2} t={t} prefix={false} testId="chip-r2" />}
                  </td>
                  <td className={`${tdClass} ${wideOnly} text-end tabular-nums`}>{formatNumber(v.views, locale)}</td>
                  <td className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}>
                    {v.createdAt ? <time dateTime={v.createdAt}>{formatDate(v.createdAt, locale)}</time> : t('content.none')}
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
