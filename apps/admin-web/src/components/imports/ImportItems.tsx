'use client';

/**
 * One page of an import batch's files (wiki TOOLS-ADMIN TA-8): the file, its video and how far the
 * server got with it, its state in the batch, the sidecars the attach job puts on the video (with the
 * job's attempts n/max, next try, error in plain words, Retry and Cancel), and each caption language.
 * A table from the md breakpoint, cards on a phone.
 */
import { useEffect, useState } from 'react';
import Link from '@/components/AppLink';
import { formatBytes, intlLocale, type AdminContentPermission, type AdminImportItem, type AdminImportItemStatus, type ImportCaptionStatus, type ImportSidecarPart } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { pageStart } from '@/i18n/config';
import { translateDynamic, type MessageKey } from '@/i18n/translate';
import { linkClass } from '@/components/ui';
import { LocalTime } from '@/components/LocalTime';
import { ActionFeedback, useContentAction } from '@/components/content/actions';
import { Chip, cardTable, thClass, type ChipTone } from '@/components/content/parts';
import { fillNodes } from '@/components/audit/fill';
import { JobStatusChip } from '@/components/content/job-status-chip';
import { useRefreshWhile } from '@/components/content/jobs';
import { JobActionButtons, JobErrorText, JobTiming, useJobCancel } from '@/components/content/job-parts';
import { isActiveJob } from '@/components/content/job-helpers';

const STATE_TONE: Record<AdminImportItem['state'], ChipTone> = { initiated: 'warn', uploaded: 'good', failed: 'bad' };
const VIDEO_TONE: Record<string, ChipTone> = { completed: 'good', failed: 'bad', archived: 'neutral' };
const CAPTION_TONE: Record<ImportCaptionStatus['state'], ChipTone> = { working: 'info', published: 'good', draft: 'warn', failed: 'bad' };

function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([intlLocale(locale)], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function Sidecars({ status, permissions, action, onCancelAsk }: { status: AdminImportItemStatus; permissions: readonly AdminContentPermission[]; action: ReturnType<typeof useContentAction>; onCancelAsk: Parameters<typeof JobActionButtons>[0]['onCancelAsk'] }) {
  const { t } = useLanguage();
  const attach = status.attach;
  if (!attach) return <span className="text-sm text-fg-muted">{t('imports.noSidecars')}</span>;
  const done = new Set(attach.done);
  const parts: ImportSidecarPart[] = attach.sent ?? attach.done;
  const stopped = attach.status === 'failed' || attach.status === 'cancelled';
  return (
    <div className="space-y-2" data-testid="import-sidecars">
      <ul className="flex flex-wrap gap-1.5">
        {parts.map((part) => {
          const state = done.has(part) ? 'done' : stopped ? 'stopped' : 'waiting';
          return (
            <li key={part} data-part={part} data-state={state}>
              <Chip tone={state === 'done' ? 'good' : state === 'stopped' ? 'bad' : 'warn'}>
                {t(`imports.parts.${part}` as MessageKey)}
                <span className="font-normal">
                  {' '}({t(state === 'done' ? 'imports.partDone' : state === 'stopped' ? 'imports.partStopped' : 'imports.partWaiting')})
                </span>
              </Chip>
            </li>
          );
        })}
      </ul>
      <div className="text-xs text-fg-muted">
        <span className="me-2">{t('imports.attachJob')}</span>
        <JobStatusChip job={{ status: attach.status }} />
        <JobTiming job={attach} />
      </div>
      {attach.lastError && attach.status !== 'succeeded' && <JobErrorText error={attach.lastError} testId="import-attach-error" />}
      {attach.warnings.length > 0 && (
        <ul className="text-xs text-warning-fg space-y-0.5" data-testid="import-sidecar-warnings">
          {attach.warnings.map((w) => {
            // A known code is a sentence; anything else says a part was left out, with what was sent under Technical details
            const words = translateDynamic(t, 'imports.warningText', w);
            return (
              <li key={w} data-warning={w}>
                {words !== w ? (
                  words
                ) : (
                  <>
                    {t('imports.skippedOther')}
                    <details className="mt-0.5 text-fg-muted">
                      <summary className="cursor-pointer select-none hover:text-fg">{t('jobs.technical')}</summary>
                      <code dir="ltr" className="block mt-1 font-mono whitespace-pre-wrap text-start">
                        {w}
                      </code>
                    </details>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/videos/${encodeURIComponent(status.videoId)}#jobs-panel`} className={`${linkClass} text-xs`}>
          {t('imports.openJob')}
        </Link>
        <JobActionButtons job={{ id: attach.jobId, kind: 'import.attach', status: attach.status }} permissions={permissions} action={action} onCancelAsk={onCancelAsk} />
      </div>
    </div>
  );
}

function Captions({ captions }: { captions: ImportCaptionStatus[] }) {
  const { t, locale } = useLanguage();
  if (!captions.length) return <span className="text-sm text-fg-muted">{t('imports.noCaptions')}</span>;
  return (
    <ul className="space-y-1.5" data-testid="import-captions">
      {captions.map((c) => (
        <li key={c.language} data-language={c.language} data-state={c.state} className="text-sm">
          <span className="font-medium text-fg me-2">{languageName(c.language, locale)}</span>
          <Chip tone={CAPTION_TONE[c.state]}>{t(`imports.captionStates.${c.state}` as MessageKey)}</Chip>
          {(c.origin || c.job) && (
            <span className="block text-xs text-fg-muted">
              {c.origin ? t(`imports.captionOrigins.${c.origin}` as MessageKey) : t(`imports.captionJobs.${c.job}` as MessageKey)}
            </span>
          )}
          {c.state === 'failed' && c.error && <span className="block text-xs text-danger-fg">{t(`imports.captionErrors.${c.error}` as MessageKey)}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ImportItems({ items, statuses, permissions }: { items: AdminImportItem[]; statuses: Record<string, AdminImportItemStatus> | null; permissions: AdminContentPermission[] }) {
  const { t, locale } = useLanguage();
  // Names and titles in the other script still line up with their row (AUDIT-2)
  const start = pageStart(locale);
  const action = useContentAction();
  const cancel = useJobCancel(action);
  // Refresh while an attach job is still going
  useRefreshWhile(!!statuses && Object.values(statuses).some((s) => !!s.attach && isActiveJob(s.attach)));
  const dash = <span className="text-fg-subtle">—</span>;
  // The file a link pointed at (#item-<id>, from the Errors page through ?video=): marked and scrolled to.
  // Read on the client: :target does not match after a client-side redirect to a hash.
  const [marked, setMarked] = useState<string | null>(null);
  useEffect(() => {
    const id = /^#item-([A-Za-z0-9_-]{1,200})$/.exec(window.location.hash)?.[1] ?? null;
    setMarked(id);
    if (id) document.getElementById(`item-${id}`)?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <div>
      <ActionFeedback error={action.error} message={action.message} />
      <div className={cardTable.wrap}>
        <table className={cardTable.table} data-testid="import-items">
          <caption className="sr-only">{t('imports.itemsCaption')}</caption>
          <thead className={cardTable.head}>
            <tr>
              <th className={thClass} scope="col">{t('imports.colFile')}</th>
              <th className={thClass} scope="col">{t('imports.colVideo')}</th>
              <th className={thClass} scope="col">{t('imports.colSidecars')}</th>
              <th className={thClass} scope="col">{t('imports.colCaptions')}</th>
            </tr>
          </thead>
          <tbody className={cardTable.body}>
            {items.map((item) => {
              const status = statuses?.[item.id];
              return (
                <tr key={item.id} id={`item-${item.id}`} className={`${cardTable.row} scroll-mt-24 ${marked === item.id ? 'bg-surface-hover outline-2 outline-solid -outline-offset-2 outline-focus' : ''}`} data-testid="import-item" data-item-id={item.id} data-state={item.state} data-marked={marked === item.id ? 'true' : undefined}>
                  <td className={`${cardTable.cell} md:min-w-56`}>
                    {/* A file name stays whole: one line, an ellipsis when the column is narrow, the full name on hover */}
                    <span className="block max-w-full md:max-w-72 font-medium text-fg truncate" dir="auto" style={{ textAlign: start }} title={item.fileName}>
                      {item.fileName}
                    </span>
                    <span className="block text-xs text-fg-muted mt-0.5">
                      {/* File sizes stay exact; Arabic is never grouped and joins with «،» (number rule O38) */}
                      {fillNodes(t('imports.fileMeta'), { size: formatBytes(locale, item.fileSize), date: <LocalTime value={item.createdAt} withTime /> })}
                    </span>
                    <span className="block mt-1.5">
                      <Chip tone={STATE_TONE[item.state]} testId="import-item-state">
                        {t(`imports.states.${item.state}` as MessageKey)}
                      </Chip>
                    </span>
                    {item.state === 'failed' && item.error && (
                      <div className="mt-1 text-xs">
                        <p className="text-danger-fg">{t('imports.appGaveUp')}</p>
                        <details className="mt-1 text-fg-muted">
                          <summary className="cursor-pointer select-none hover:text-fg">{t('jobs.technical')}</summary>
                          <code dir="ltr" className="block mt-1 font-mono whitespace-pre-wrap text-start">
                            {item.error}
                          </code>
                        </details>
                      </div>
                    )}
                  </td>
                  <td className={cardTable.cell}>
                    {!item.videoId ? (
                      <span className="text-sm text-fg-muted">{t('imports.noVideo')}</span>
                    ) : !statuses ? (
                      dash
                    ) : !status?.video || status.video.isDeleted ? (
                      <span className="text-sm text-fg-muted">{t('imports.videoGone')}</span>
                    ) : (
                      <>
                        <Link href={`/videos/${encodeURIComponent(item.videoId)}`} className={`${linkClass} block font-medium break-words [text-wrap:balance]`} dir="auto" style={{ textAlign: start }}>
                          {status.video.title || item.fileName}
                        </Link>
                        {status.video.processingStatus && (
                          <span className="block mt-1">
                            <Chip tone={VIDEO_TONE[status.video.processingStatus] ?? 'warn'} testId="import-video-status">
                              {t(`imports.video.${status.video.processingStatus}` as MessageKey)}
                            </Chip>
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className={cardTable.cell}>
                    <span className="md:hidden block text-xs font-medium text-fg-muted mb-1">{t('imports.colSidecars')}</span>
                    {status ? <Sidecars status={status} permissions={permissions} action={action} onCancelAsk={cancel.ask} /> : item.videoId && !statuses ? dash : <span className="text-sm text-fg-muted">{t('imports.noSidecars')}</span>}
                  </td>
                  <td className={cardTable.cell}>
                    <span className="md:hidden block text-xs font-medium text-fg-muted mb-1">{t('imports.colCaptions')}</span>
                    {status ? <Captions captions={status.captions} /> : item.videoId && !statuses ? dash : <span className="text-sm text-fg-muted">{t('imports.noCaptions')}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cancel.dialog}
    </div>
  );
}
