'use client';

/**
 * Admin jobs in the UI. Heavy actions (deletes, suspend and ban cascades,
 * transfers, moves) run as queued jobs in api-videos; these components show
 * their status on the item ("running", "failed — Retry") and keep the page
 * fresh while a job is still in progress.
 */
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { retryJob } from '@/lib/api/content';
import type { AdminContentPermission, AdminJob } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { linkClass } from '@/components/ui';
import { ActionFeedback, useContentAction } from './actions';
import { Chip, SectionCard, smallButtonClass } from './parts';
import { canRetryJob, isActiveJob, jobTargetHref, jobTone } from './job-helpers';

/** How often a page with a running job re-reads it. */
const REFRESH_MS = 3000;

/** Re-renders the server page every few seconds while `active` (a job is in progress). */
export function useRefreshWhile(active: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, router]);
}

export function JobStatusChip({ job }: { job: Pick<AdminJob, 'status'> }) {
  const { t } = useLanguage();
  const label = job.status === 'failed' ? t('jobs.failedRetry') : t(`jobs.statuses.${job.status}` as MessageKey);
  return (
    <Chip tone={jobTone(job.status)} testId="job-status">
      {isActiveJob(job) && <span aria-hidden="true" className="me-1 inline-block h-2 w-2 rounded-full bg-current animate-pulse" />}
      {label}
    </Chip>
  );
}

/**
 * The item's latest background jobs. `jobs === null` means admin-api could
 * not read them: that is said plainly, never shown as "no jobs".
 */
export function JobsPanel({ jobs, permissions }: { jobs: AdminJob[] | null; permissions: AdminContentPermission[] }) {
  const { t, locale } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  const active = !!jobs?.some(isActiveJob);
  useRefreshWhile(active);

  return (
    <SectionCard title={t('jobs.panelTitle')} id="jobs-panel" testId="jobs-panel">
      <ActionFeedback error={error} message={message} />
      {jobs === null ? (
        <p className="text-sm text-warning-fg" data-testid="jobs-unknown">{t('jobs.panelUnknown')}</p>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('jobs.panelEmpty')}</p>
      ) : (
        <ul className="space-y-3" data-active={active ? 'true' : 'false'}>
          {jobs.map((job) => (
            <li key={job.id} className="border border-border rounded p-3 bg-surface-2" data-testid="job-item" data-job-id={job.id} data-job-kind={job.kind} data-job-status={job.status}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-fg">{t(`jobs.kinds.${job.kind}` as MessageKey)}</span>
                <JobStatusChip job={job} />
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                {formatDate(job.updatedAt, locale, true)}
                {job.attempts > 0 && <> · {t('jobs.attempts', { count: job.attempts })}</>}
              </p>
              {job.lastError && job.status !== 'succeeded' && (
                <p className="mt-2 text-xs text-danger-fg break-words" dir="ltr" data-testid="job-error">
                  {t('jobs.lastError', { error: job.lastError })}
                </p>
              )}
              {job.status === 'failed' && canRetryJob(job, permissions) && (
                <div className="mt-2">
                  <button
                    type="button"
                    className={smallButtonClass}
                    disabled={!!busy}
                    onClick={() => run(`retry:${job.id}`, () => retryJob(job.id), { success: t('jobs.retried') })}
                    data-testid="job-retry"
                  >
                    {busy === `retry:${job.id}` ? t('content.working') : t('jobs.retry')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {active && <p className="mt-3 text-xs text-fg-subtle">{t('jobs.autoRefresh')}</p>}
    </SectionCard>
  );
}

/** Banner for list pages: failed jobs need an admin. */
export function FailedJobsBanner({ count }: { count: number }) {
  const { t } = useLanguage();
  if (count <= 0) return null;
  return (
    <div role="status" data-testid="failed-jobs-banner" className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded border border-danger-border bg-danger-bg px-4 py-3 text-danger-fg">
      <span>{t('jobs.failedBanner', { count })}</span>
      <Link href="/jobs?status=failed" className={`${linkClass} font-medium`}>
        {t('jobs.viewFailed')}
      </Link>
    </div>
  );
}

/** Jobs as a table (Jobs page, Errors page): job, item, status, attempts, last error, Retry. */
export function JobsTable({ jobs, permissions, testId = 'jobs-table' }: { jobs: AdminJob[]; permissions: AdminContentPermission[]; testId?: string }) {
  const { t, locale } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  useRefreshWhile(jobs.some(isActiveJob));
  const th = 'text-start px-3 sm:px-4 py-3 text-fg-muted font-medium whitespace-nowrap text-sm';
  const td = 'px-3 sm:px-4 py-3 align-top text-sm';
  const wide = 'hidden md:table-cell';
  return (
    <div>
      <ActionFeedback error={error} message={message} />
      <div className="bg-surface border border-border rounded-lg overflow-x-auto">
        <table className="w-full" data-testid={testId}>
          <caption className="sr-only">{t('jobs.tableCaption')}</caption>
          <thead className="border-b border-border">
            <tr>
              <th className={th} scope="col">{t('jobs.colJob')}</th>
              <th className={th} scope="col">{t('jobs.colStatus')}</th>
              <th className={`${th} ${wide}`} scope="col">{t('jobs.colError')}</th>
              <th className={`${th} ${wide}`} scope="col">{t('jobs.colUpdated')}</th>
              <th className={th} scope="col"><span className="sr-only">{t('content.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b border-border last:border-0" data-testid="job-row" data-job-id={job.id} data-job-kind={job.kind} data-job-status={job.status}>
                <td className={td}>
                  <span className="block font-medium text-fg">{t(`jobs.kinds.${job.kind}` as MessageKey)}</span>
                  <Link href={jobTargetHref(job)} className={`${linkClass} text-xs`}>
                    {t(`jobs.targets.${job.targetKind}` as MessageKey)} <span className="font-mono" dir="ltr">{job.targetId.length > 24 ? `${job.targetId.slice(0, 24)}…` : job.targetId}</span>
                  </Link>
                  <span className="block text-xs text-fg-subtle">{t('jobs.by', { actor: job.actorId })}</span>
                  {job.lastError && job.status !== 'succeeded' && <span className="block md:hidden text-xs text-danger-fg break-words mt-1" dir="ltr">{job.lastError}</span>}
                </td>
                <td className={td}>
                  <JobStatusChip job={job} />
                  {job.attempts > 0 && <span className="block text-xs text-fg-muted mt-1">{t('jobs.attempts', { count: job.attempts })}</span>}
                </td>
                <td className={`${td} ${wide} text-danger-fg break-words max-w-md`} dir="ltr">{job.status !== 'succeeded' ? job.lastError ?? '' : ''}</td>
                <td className={`${td} ${wide} text-fg-muted whitespace-nowrap`}><time dateTime={job.updatedAt}>{formatDate(job.updatedAt, locale, true)}</time></td>
                <td className={td}>
                  {job.status === 'failed' && canRetryJob(job, permissions) && (
                    <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => run(`retry:${job.id}`, () => retryJob(job.id), { success: t('jobs.retried') })} data-testid="job-retry">
                      {busy === `retry:${job.id}` ? t('content.working') : t('jobs.retry')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
