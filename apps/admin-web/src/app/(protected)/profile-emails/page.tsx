import type { AdminJob, ProfileEmailsResult } from '@al-ummah/shared-types';
import { listProfileEmailJobs } from '@/lib/api/profile-emails';
import { getAdminSession } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatNumber } from '@/i18n/translate';
import { ErrorAlert, cardClass } from '@/components/ui';
import { JobRetry, RefreshWhileActive } from '@/components/AdminJobActions';
import { JOB_STATUS_LABEL, isJobActive } from '@/lib/admin-jobs';
import { logger } from '@/lib/logger';
import { UserName } from '@/components/audit/UserName';
import { LocalTime } from '@/components/LocalTime';
import { CsamEmailCheck, ProfileEmailsReport, ProfileEmailsStart } from './ProfileEmails';
import { repairableCheck, reportPages } from './model';

export const dynamic = 'force-dynamic';

/**
 * Profile emails (super admins): a check compares the email stored on profiles and their channels with
 * the sign-in accounts and changes nothing; a repair, offered after a check, writes the account's on
 * profiles that differ and removes it from channels that do. Each run shows its counts and its private report. CSAM cases are checked on their own.
 */
export default async function ProfileEmailsPage() {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!isSuperAdmin(session?.user.role)) return <ErrorAlert testId="profile-emails-no-access">{t('profileEmails.noAccess')}</ErrorAlert>;

  const jobs = await listProfileEmailJobs().catch((e): AdminJob[] | null => {
    logger.error('[profile-emails] Jobs failed to load', { error: e instanceof Error ? e.message : String(e) });
    return null;
  });
  const running = !!jobs?.some((j) => isJobActive(j.status));

  return (
    <div className="space-y-8">
      <RefreshWhileActive active={running} />
      <div>
        <h1 className="text-3xl font-bold text-fg">{t('profileEmails.title')}</h1>
        <p className="text-fg-muted mt-1 max-w-3xl">{t('profileEmails.subtitle')}</p>
      </div>

      <section aria-labelledby="profile-emails-runs" className="space-y-3">
        <h2 id="profile-emails-runs" className="text-xl font-semibold text-fg">{t('profileEmails.runsTitle')}</h2>
        {jobs && <ProfileEmailsStart running={running} check={repairableCheck(jobs)} />}
        {!jobs && <ErrorAlert testId="profile-emails-error">{t('profileEmails.loadFailed')}</ErrorAlert>}
        {jobs && jobs.length === 0 && <div className={`${cardClass} text-center text-fg-muted`} data-testid="profile-emails-empty">{t('profileEmails.empty')}</div>}
        {jobs?.map((job) => {
          const result = job.result as unknown as ProfileEmailsResult | null;
          const mode = job.params.mode === 'repair' ? 'repair' : 'check';
          const counts: Array<[string, number]> = result
            ? [
                [t('profileEmails.scanned'), result.scanned],
                [t('profileEmails.matching'), result.matching],
                [t('profileEmails.differs'), result.differs],
                [t('profileEmails.missing'), result.missing],
                [t('profileEmails.channels'), result.channels],
                [t('profileEmails.noAccount'), result.noAccount],
                ...(result.unreadable ? ([[t('profileEmails.unreadable'), result.unreadable]] as Array<[string, number]>) : []),
                ...(mode === 'repair'
                  ? ([
                      [t('profileEmails.profilesWritten'), result.profilesWritten],
                      [t('profileEmails.channelsWritten'), result.channelsWritten],
                    ] as Array<[string, number]>)
                  : []),
              ]
            : [];
          return (
            <article key={job.id} className={`${cardClass} space-y-3`} data-testid="profile-emails-job" data-job-id={job.id} data-mode={mode} data-status={job.status}>
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="font-semibold text-fg">{t(mode === 'repair' ? 'profileEmails.repair' : 'profileEmails.check')}</h3>
                <span className="text-sm text-fg-muted" data-testid="profile-emails-status">{t(JOB_STATUS_LABEL[job.status])}</span>
                <span className="text-sm text-fg-muted"><LocalTime value={job.createdAt} withTime /></span>
                <span className="text-sm text-fg-muted"><UserName id={job.actorId} showEmail={false} /></span>
                {job.status === 'failed' && <JobRetry id={job.id} />}
              </header>
              {job.lastError && <p className="text-danger-fg text-sm break-words">{job.lastError}</p>}
              {counts.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                  {counts.map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-fg-muted">{label}</dt>
                      <dd className="text-fg font-semibold">{formatNumber(value, locale)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {reportPages(result).length > 0 && <ProfileEmailsReport jobId={job.id} pages={reportPages(result)} />}
            </article>
          );
        })}
      </section>

      <section aria-labelledby="profile-emails-csam" className="space-y-3">
        <h2 id="profile-emails-csam" className="text-xl font-semibold text-fg">{t('profileEmails.csamTitle')}</h2>
        <p className="text-fg-muted text-sm max-w-3xl">{t('profileEmails.csamNote')}</p>
        <CsamEmailCheck />
      </section>
    </div>
  );
}
