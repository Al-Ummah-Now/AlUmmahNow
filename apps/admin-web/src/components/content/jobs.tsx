'use client';

/**
 * Admin jobs in the UI. Heavy actions (deletes, suspend and ban cascades,
 * transfers, moves) run as queued jobs in api-videos; these components show
 * their status on the item ("running", "failed — Retry") and keep the page
 * fresh while a job is still in progress.
 */
import { useAdminLive } from '@/lib/live/useAdminLive';
import Link from '@/components/AppLink';
import { useRouter } from 'next/navigation';
import type { AdminContentPermission, AdminJob } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { linkClass } from '@/components/ui';
import { ActionFeedback, useContentAction } from './actions';
import { Chip, SectionCard } from './parts';
import { isActiveJob, jobTargetHref, jobTone } from './job-helpers';
import { JobActionButtons, JobErrorText, JobLog, JobTiming, useJobCancel } from './job-parts';
import { LocalTime } from '@/components/LocalTime';
import { JOB_KIND_LABEL } from '@/lib/admin-jobs';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';

/** How often a page with a running job re-reads it while the live socket is down. */
const REFRESH_MS = 3000;

/**
 * While `active` (a job is in progress), re-renders the server page when a job
 * changes (admin:jobs live updates); polls every few seconds only while the
 * socket is down.
 */
export function useRefreshWhile(active: boolean) {
  const router = useRouter();
  useAdminLive(['jobs'], () => router.refresh(), { poll: () => router.refresh(), pollMs: REFRESH_MS, enabled: active, catchUpOnFirstLive: true });
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
  const { t } = useLanguage();
  const action = useContentAction();
  const { error, message } = action;
  const cancel = useJobCancel(action);
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
                <span className="font-medium text-fg">{t(JOB_KIND_LABEL[job.kind])}</span>
                <JobStatusChip job={job} />
              </div>
              <LocalTime value={job.updatedAt} className="block mt-1 text-xs text-fg-muted" />
              <JobTiming job={job} />
              {job.lastError && job.status !== 'succeeded' && (
                <div className="mt-2">
                  <JobErrorText error={job.lastError} />
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
                <JobLog job={job} />
                <JobActionButtons job={job} permissions={permissions} action={action} onCancelAsk={cancel.ask} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {active && <p className="mt-3 text-xs text-fg-subtle">{t('jobs.autoRefresh')}</p>}
      {cancel.dialog}
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

/**
 * Jobs as a table (Jobs page, Errors page): job and item, status with attempts n/max and the next try,
 * the last error in plain words, when it changed, Retry and Cancel, and each job's log.
 */
export function JobsTable({ jobs, permissions, testId = 'jobs-table' }: { jobs: AdminJob[]; permissions: AdminContentPermission[]; testId?: string }) {
  const { t } = useLanguage();
  const action = useContentAction();
  const { error, message } = action;
  const cancel = useJobCancel(action);
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
                  <span className="block font-medium text-fg">{t(JOB_KIND_LABEL[job.kind])}</span>
                  <Link href={jobTargetHref(job)} className={`${linkClass} text-xs`}>
                    {t(`jobs.targets.${job.targetKind}` as MessageKey)} <span className="font-mono" dir="ltr">{job.targetId.length > 24 ? `${job.targetId.slice(0, 24)}…` : job.targetId}</span>
                  </Link>
                  <span className="block text-xs text-fg-subtle">{fillNodes(t('jobs.by'), { actor: <UserName id={job.actorId} showEmail={false} /> })}</span>
                  {job.lastError && job.status !== 'succeeded' && (
                    <div className="md:hidden mt-1">
                      <JobErrorText error={job.lastError} testId="job-error-narrow" />
                    </div>
                  )}
                  <div className="mt-2">
                    <JobLog job={job} />
                  </div>
                </td>
                <td className={td}>
                  <JobStatusChip job={job} />
                  <JobTiming job={job} />
                </td>
                <td className={`${td} ${wide} max-w-md`}>{job.lastError && job.status !== 'succeeded' ? <JobErrorText error={job.lastError} /> : null}</td>
                <td className={`${td} ${wide} text-fg-muted whitespace-nowrap`}>
                  <LocalTime value={job.updatedAt} />
                </td>
                <td className={td}>
                  <JobActionButtons job={job} permissions={permissions} action={action} onCancelAsk={cancel.ask} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cancel.dialog}
    </div>
  );
}
