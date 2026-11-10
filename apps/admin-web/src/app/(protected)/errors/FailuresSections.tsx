import Link from 'next/link';
import { getProcessingErrors, listContactMessages, listFlaggedVideoFormats } from '@/lib/api/admin';
import type { ContactListResponse, FlaggedVideoList, ProcessingErrorsResponse } from '@/lib/api/types';
import { canUseContactInbox, canUseProcessing } from '@/lib/roles';
import type { getI18n } from '@/i18n/server';
import { formatDate, translateDynamic } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { getContentPermissions, listJobs } from '@/lib/api/content';
import type { AdminContentPermission, AdminJob } from '@/lib/api/content-types';
import { JobsTable } from '@/components/content/jobs';
import { logger } from '@/lib/logger';
import { ISSUE_LABEL, ourStatusLabel } from '../processing/labels';
import { indexItemHref, thumbnailFixHref } from './filters';
import { IndexRebuildButton } from './IndexRebuildButton';
import { JOB_STATUS_LABEL, isJobActive } from '@/lib/admin-jobs';
import type { MessageKey } from '@/i18n/translate';

/** Label of each ownership index kind (Errors page, "Index out of sync"). */
export const INDEX_KIND_LABEL: Record<'video' | 'channel' | 'profile', MessageKey> = {
  video: 'errorsPage.indexKindVideo',
  channel: 'errorsPage.indexKindChannel',
  profile: 'errorsPage.indexKindProfile',
};

const thClass = 'text-start px-4 py-3 text-fg-muted font-medium whitespace-nowrap';
const tdClass = 'px-4 py-3 align-top text-sm';

export interface Failures {
  canProcess: boolean;
  /** Failed or flagged uploads and dead-lettered processing checks (videos:processing); null when it could not load */
  data: ProcessingErrorsResponse | null;
  /** Contact us emails that failed after the mail queue's retries (contact inbox roles) */
  contactFailed: ContactListResponse | null;
  /** Videos Bunny cannot describe (no length or size): a Short/video decision is needed (videos:format, admins) */
  formatFlagged: FlaggedVideoList | null;
  /** Admin jobs (channel/video/user deletes, cascades, transfers, moves) that failed after retries; null when they could not load */
  failedJobs: AdminJob[] | null;
  jobPermissions: AdminContentPermission[];
}

/** Loads what the role may see. Never throws: a failed load shows its own notice. */
export async function loadFailures(role: string | undefined): Promise<Failures> {
  const canProcess = canUseProcessing(role);
  let data: ProcessingErrorsResponse | null = null;
  if (canProcess) {
    try {
      data = await getProcessingErrors();
    } catch (e) {
      logger.error('[errors] Failed to load processing failures', { error: e instanceof Error ? e.message : String(e) });
    }
  }
  let contactFailed: ContactListResponse | null = null;
  if (canUseContactInbox(role)) {
    try {
      contactFailed = await listContactMessages({ status: 'send_failed', limit: 20 });
    } catch (e) {
      logger.error('[errors] Failed to load contact mail failures', { error: e instanceof Error ? e.message : String(e) });
    }
  }
  let formatFlagged: FlaggedVideoList | null = null;
  if (canProcess) {
    try {
      formatFlagged = await listFlaggedVideoFormats(20, 0);
    } catch (e) {
      logger.error('[errors] Failed to load unclassified videos', { error: e instanceof Error ? e.message : String(e) });
    }
  }
  let failedJobs: AdminJob[] | null = null;
  let jobPermissions: AdminContentPermission[] = [];
  if (canProcess) {
    try {
      [failedJobs, jobPermissions] = await Promise.all([listJobs({ status: 'failed', limit: 20 }), getContentPermissions()]);
    } catch (e) {
      logger.error('[errors] Failed to load failed admin jobs', { error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { canProcess, data, contactFailed, formatFlagged, failedJobs, jobPermissions };
}

/** True when any section has something for an admin to do. */
export function hasFailures(f: Failures): boolean {
  return !!(
    f.data?.videos.length ||
    f.data?.deadLetters.length ||
    f.data?.erasureDeadLetters?.length ||
    f.data?.thumbnailRuns?.length ||
    f.data?.thumbnailFlagged?.items.length ||
    f.data?.indexDrift?.length ||
    f.formatFlagged?.items.length ||
    f.contactFailed?.messages.length ||
    f.failedJobs?.length
  );
}

/**
 * Failures that need an admin outside the error groups: uploads that failed or
 * were flagged (needs re-upload, stalled) and processing checks that
 * dead-lettered after their retries (each links to Processing health, where
 * it can be synced, retried or marked failed), and Contact us emails that
 * failed after the mail queue's retries (each links to the message, where it
 * can be retried), account erasure steps that dead-lettered, thumbnail repair
 * runs that failed after their retries, thumbnails the daily check found of
 * another shape than their video (fixed by hand on the video page), indexes the
 * admin lists read that miss stored items (Rebuild queues the index rebuild job), and admin jobs
 * (heavy content actions) that failed after their retries, with Retry.
 */
export function FailuresSections({ failures, t, locale }: { failures: Failures; t: Awaited<ReturnType<typeof getI18n>>['t']; locale: Awaited<ReturnType<typeof getI18n>>['locale'] }) {
  const { canProcess, data, contactFailed, formatFlagged, failedJobs, jobPermissions } = failures;
  return (
    <>
      {canProcess && !data && <ErrorAlert testId="errors-processing-error">{t('errorsPage.processingLoadFailed')}</ErrorAlert>}

      {!!data?.indexDrift?.length && (
        <section aria-labelledby="errors-index" data-testid="errors-index-section">
          <div className="mb-3">
            <h2 id="errors-index" className="text-xl font-semibold text-fg">{t('errorsPage.indexTitle')}</h2>
            <p className="mt-1 text-sm text-fg-muted">{t('errorsPage.indexHint', { when: formatDate(data.indexDrift[0].at, locale, true) })}</p>
          </div>
          <div className="bg-surface border border-border rounded-lg overflow-x-auto">
            <table className="w-full" data-testid="errors-index">
              <caption className="sr-only">{t('errorsPage.indexCaption')}</caption>
              <thead className="border-b border-border">
                <tr>
                  <th className={thClass} scope="col">{t('errorsPage.colIndex')}</th>
                  <th className={thClass} scope="col">{t('errorsPage.colStored')}</th>
                  <th className={thClass} scope="col">{t('errorsPage.colIndexed')}</th>
                  <th className={thClass} scope="col">{t('errorsPage.colSkipped')}</th>
                  <th className={thClass} scope="col">{t('errorsPage.colUnreadable')}</th>
                  <th className={thClass} scope="col">{t('errorsPage.colExamples')}</th>
                  <th className={thClass} scope="col"><span className="sr-only">{t('errorsPage.rebuild')}</span></th>
                </tr>
              </thead>
              <tbody>
                {data.indexDrift.map((d) => (
                  <tr key={d.kind} className="border-b border-border last:border-0" data-index-kind={d.kind}>
                    <td className={tdClass}>
                      <div className="text-fg">{t(INDEX_KIND_LABEL[d.kind])}</div>
                      <div className="text-fg-muted text-xs">{formatDate(d.at, locale, true)}</div>
                    </td>
                    <td className={tdClass}>{d.stored}</td>
                    <td className={tdClass}>{d.indexed}</td>
                    <td className={tdClass}>{d.skipped}</td>
                    <td className={tdClass}>{d.failed}</td>
                    <td className={tdClass}>
                      <ul className="space-y-1">
                        {d.sampleIds.slice(0, 5).map((id) => (
                          <li key={id}>
                            <Link href={indexItemHref(d.kind, id)} className={linkClass}><span dir="ltr" className="text-xs">{id}</span></Link>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className={tdClass}>
                      <IndexRebuildButton kind={d.kind} active={!!d.rebuild && isJobActive(d.rebuild.status)} />
                      {d.rebuild && (
                        <div className="mt-1 text-fg-muted text-xs" data-testid={`index-rebuild-status-${d.kind}`}>
                          {t('errorsPage.rebuildStatus', { status: t(JOB_STATUS_LABEL[d.rebuild.status]) })}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && (
        <section aria-labelledby="errors-videos">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="errors-videos" className="text-xl font-semibold text-fg">{t('errorsPage.videosTitle')}</h2>
            <Link href="/processing?status=failed" className={linkClass}>{t('errorsPage.openProcessing')}</Link>
          </div>
          {data.videos.length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="errors-videos-empty">{t('errorsPage.videosEmpty')}</div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="errors-videos">
                <caption className="sr-only">{t('errorsPage.videosTitle')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('errorsPage.colWhen')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colVideo')}</th>
                    <th className={thClass} scope="col">{t('processing.colOurs')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colReason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.videos.map((v) => {
                    const when = v.processingIssue?.at || v.dateModified;
                    return (
                      <tr key={v.id} className="border-b border-border last:border-0" data-video-id={v.id}>
                        <td className={tdClass}>{when ? formatDate(when, locale, true) : '—'}</td>
                        <td className={tdClass}>
                          <div className="font-medium text-fg">{v.title || v.id}</div>
                          <div className="text-fg-muted text-xs" dir="ltr">{v.id}</div>
                        </td>
                        <td className={tdClass}>
                          {v.processingIssue ? t(ISSUE_LABEL[v.processingIssue.kind]) : ourStatusLabel(t, v.uploadStatus)}
                        </td>
                        <td className={tdClass}>{v.processingIssue?.reason || t('errorsPage.noReason')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data && (
        <section aria-labelledby="errors-dead">
          <h2 id="errors-dead" className="text-xl font-semibold text-fg mb-3">{t('errorsPage.deadTitle')}</h2>
          {data.deadLetters.length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="errors-dead-empty">{t('errorsPage.deadEmpty')}</div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="errors-dead">
                <caption className="sr-only">{t('errorsPage.deadCaption')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('errorsPage.colWhen')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colVideo')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colReason')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colAttempts')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.deadLetters.map((d) => (
                    <tr key={d.id} className="border-b border-border last:border-0">
                      <td className={tdClass}>{formatDate(d.receivedAt, locale, true)}</td>
                      <td className={tdClass} dir="ltr">{d.videoId ?? '—'}</td>
                      <td className={tdClass}>{d.failureReason || t('errorsPage.noReason')}</td>
                      <td className={tdClass}>{d.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data && (
        <section aria-labelledby="errors-erasure">
          <h2 id="errors-erasure" className="text-xl font-semibold text-fg mb-1">{t('errorsPage.erasureTitle')}</h2>
          <p className="text-fg-muted text-sm mb-3">{t('errorsPage.erasureHint')}</p>
          {(data.erasureDeadLetters ?? []).length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="errors-erasure-empty">{t('errorsPage.erasureEmpty')}</div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="errors-erasure">
                <caption className="sr-only">{t('errorsPage.erasureTitle')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('errorsPage.colWhen')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colAccount')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colStep')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colReason')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colAttempts')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.erasureDeadLetters ?? []).map((d) => (
                    <tr key={d.id} className="border-b border-border last:border-0" data-dead-letter-id={d.id}>
                      <td className={tdClass}>{formatDate(d.receivedAt, locale, true)}</td>
                      <td className={tdClass}>
                        {d.userId ? (
                          <Link href={`/users/${encodeURIComponent(d.userId)}`} className={linkClass} dir="ltr">{d.userId}</Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={tdClass}>{t(d.step === 'ContactDataErase' ? 'errorsPage.stepContact' : 'errorsPage.stepAccount')}</td>
                      <td className={`${tdClass} break-words`}>{d.failureReason || t('errorsPage.noReason')}</td>
                      <td className={tdClass}>{d.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data && (
        <section aria-labelledby="errors-thumbs">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="errors-thumbs" className="text-xl font-semibold text-fg">{t('errorsPage.thumbRunsTitle')}</h2>
            <Link href="/processing" className={linkClass}>{t('errorsPage.openThumbnails')}</Link>
          </div>
          {(data.thumbnailRuns ?? []).length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="errors-thumbs-empty">{t('errorsPage.thumbRunsEmpty')}</div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="errors-thumbs">
                <caption className="sr-only">{t('errorsPage.thumbRunsCaption')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('errorsPage.colWhen')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colRun')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colReason')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colAttempts')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.thumbnailRuns ?? []).map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0" data-run-id={r.id}>
                      <td className={tdClass}>{formatDate(r.finishedAt || r.updatedAt, locale, true)}</td>
                      <td className={tdClass}>
                        <div className="text-fg">{t(r.params.dryRun === false ? 'processing.thumbsModeFix' : 'processing.thumbsModeCheck')}</div>
                        <div className="text-fg-muted text-xs" dir="ltr">{r.id}</div>
                      </td>
                      <td className={tdClass}>{r.lastError || t('errorsPage.noReason')}</td>
                      <td className={tdClass}>{r.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {data?.thumbnailFlagged && (
        <section aria-labelledby="errors-thumb-flagged">
          <div className="mb-3">
            <h2 id="errors-thumb-flagged" className="text-xl font-semibold text-fg">{t('errorsPage.thumbFlaggedTitle')}</h2>
            <p className="mt-1 text-sm text-fg-muted">{t('errorsPage.thumbFlaggedHint', { when: formatDate(data.thumbnailFlagged.checkedAt, locale, true) })}</p>
          </div>
          {data.thumbnailFlagged.items.length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="errors-thumb-flagged-empty">{t('errorsPage.thumbFlaggedEmpty')}</div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="errors-thumb-flagged">
                <caption className="sr-only">{t('errorsPage.thumbFlaggedCaption')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('errorsPage.colVideo')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colReason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.thumbnailFlagged.items.map((item) => (
                    <tr key={item.videoId} className="border-b border-border last:border-0" data-video-id={item.videoId}>
                      <td className={tdClass}>
                        <Link href={thumbnailFixHref(item.videoId)} className={linkClass}>
                          <span dir="auto">{item.title || item.videoId}</span>
                        </Link>
                        <div className="text-fg-muted text-xs" dir="ltr">{item.videoId}</div>
                      </td>
                      <td className={tdClass}>{item.reason || t('errorsPage.noReason')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {formatFlagged && (
        <section aria-labelledby="errors-format">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="errors-format" className="text-xl font-semibold text-fg">{t('errorsPage.formatTitle')}</h2>
            <Link href="/video-formats" className={linkClass}>{t('errorsPage.openFormats')}</Link>
          </div>
          {formatFlagged.items.length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="errors-format-empty">{t('errorsPage.formatEmpty')}</div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="errors-format">
                <caption className="sr-only">{t('errorsPage.formatTitle')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('errorsPage.colWhen')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colVideo')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colReason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {formatFlagged.items.map((v) => (
                    <tr key={v.id} className="border-b border-border last:border-0" data-video-id={v.id}>
                      <td className={tdClass}>{v.formatIssue?.at ? formatDate(v.formatIssue.at, locale, true) : '—'}</td>
                      <td className={tdClass}>
                        <div className="font-medium text-fg">{v.title || v.id}</div>
                        <div className="text-fg-muted text-xs" dir="ltr">{v.id}</div>
                      </td>
                      <td className={tdClass}>{v.formatIssue?.reason || t('errorsPage.noReason')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {contactFailed && (
        <section aria-labelledby="errors-contact">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="errors-contact" className="text-xl font-semibold text-fg">{t('errorsPage.contactTitle')}</h2>
            <Link href="/contact?status=send_failed" className={linkClass}>{t('errorsPage.openContact')}</Link>
          </div>
          {contactFailed.messages.length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="errors-contact-empty">{t('errorsPage.contactEmpty')}</div>
          ) : (
            <div className="bg-surface border border-border rounded-lg overflow-x-auto">
              <table className="w-full" data-testid="errors-contact">
                <caption className="sr-only">{t('errorsPage.contactTitle')}</caption>
                <thead className="border-b border-border">
                  <tr>
                    <th className={thClass} scope="col">{t('errorsPage.colWhen')}</th>
                    <th className={thClass} scope="col">{t('contact.colFrom')}</th>
                    <th className={thClass} scope="col">{t('contact.colTopic')}</th>
                    <th className={thClass} scope="col">{t('errorsPage.colReason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {contactFailed.messages.map((m) => (
                    <tr key={m.id} className="border-b border-border last:border-0" data-message-id={m.id}>
                      <td className={tdClass}>{formatDate(m.send_failed_at ?? m.updated_at, locale, true)}</td>
                      <td className={tdClass}>
                        <Link href={`/contact/${encodeURIComponent(m.id)}`} className={linkClass} aria-label={t('contact.openMessage', { name: m.name })}>
                          <span dir="auto">{m.name}</span>
                        </Link>
                        <div className="text-fg-muted text-xs" dir="ltr">{m.email}</div>
                      </td>
                      <td className={tdClass}>{translateDynamic(t, 'contactTopic', m.topic)}</td>
                      <td className={`${tdClass} break-words`}>{m.delivery_error || t('errorsPage.noReason')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {canProcess && (
        <section aria-labelledby="errors-jobs" data-testid="errors-jobs-section">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="errors-jobs" className="text-xl font-semibold text-fg">{t('jobs.errorsTitle')}</h2>
            <Link href="/jobs" className={linkClass}>{t('jobs.openAll')}</Link>
          </div>
          {!failedJobs ? (
            <ErrorAlert testId="errors-jobs-error">{t('jobs.panelUnknown')}</ErrorAlert>
          ) : failedJobs.length === 0 ? (
            <div className={`${cardClass} text-center text-fg-muted`} data-testid="errors-jobs-empty">{t('jobs.emptyFailed')}</div>
          ) : (
            <JobsTable jobs={failedJobs} permissions={jobPermissions} testId="errors-jobs" />
          )}
        </section>
      )}
    </>
  );
}
