import { LEGACY_RESTORE_TARGET, type AdminJob, type LegacyRestorePlan, type LegacyRestoreResult } from '@al-ummah/shared-types';
import { getLegacyRestorePlan, listAdminJobs } from '@/lib/api/admin';
import { getAdminSession } from '@/lib/auth';
import { canManageVideosUsers } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, cardClass } from '@/components/ui';
import { JobRetry, LegacyRestoreRun, RefreshWhileActive } from '@/components/AdminJobActions';
import { JOB_STATUS_LABEL, isJobActive } from '@/lib/admin-jobs';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const thClass = 'text-start px-4 py-3 text-fg-muted font-medium whitespace-nowrap';
const tdClass = 'px-4 py-3 align-top text-sm';

const show = (value: unknown) => (typeof value === 'string' ? value.trim() : value == null ? '' : JSON.stringify(value));

/**
 * Restore legacy profile fields (users:manage): the dry run (planned field
 * changes, nothing written), Run (admin-api audits each profile, then queues
 * the job, which backs every profile up before it writes), and the job's runs
 * with their results; a failed run has Retry (it also shows on Errors).
 */
export default async function LegacyProfilesPage() {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canManageVideosUsers(session?.user.role)) {
    return <ErrorAlert testId="legacy-profiles-no-access">{t('legacyProfiles.noAccess')}</ErrorAlert>;
  }

  const [plan, jobs] = await Promise.all([
    getLegacyRestorePlan().catch((e): LegacyRestorePlan | null => {
      logger.error('[legacy-profiles] Dry run failed', { error: e instanceof Error ? e.message : String(e) });
      return null;
    }),
    listAdminJobs({ targetKind: LEGACY_RESTORE_TARGET.kind, targetId: LEGACY_RESTORE_TARGET.id, limit: 10 }).catch((e): AdminJob[] | null => {
      logger.error('[legacy-profiles] Jobs failed to load', { error: e instanceof Error ? e.message : String(e) });
      return null;
    }),
  ]);
  const fields = plan?.items.reduce((n, item) => n + item.changes.length, 0) ?? 0;
  const running = !!jobs?.some((j) => isJobActive(j.status));

  return (
    <div className="space-y-8">
      <RefreshWhileActive active={running} />
      <div>
        <h1 className="text-3xl font-bold text-fg">{t('legacyProfiles.title')}</h1>
        <p className="text-fg-muted mt-1 max-w-3xl">{t('legacyProfiles.subtitle')}</p>
      </div>

      <section aria-labelledby="legacy-dry-run" className="space-y-3">
        <h2 id="legacy-dry-run" className="text-xl font-semibold text-fg">{t('legacyProfiles.dryRunTitle')}</h2>
        {!plan && <ErrorAlert testId="legacy-profiles-error">{t('legacyProfiles.loadFailed')}</ErrorAlert>}
        {plan && (
          <>
            <p className="text-fg-muted text-sm max-w-3xl">{t('legacyProfiles.dryRunNote')}</p>
            <p className="text-fg" data-testid="legacy-plan-summary">
              {t('legacyProfiles.summary', { legacy: plan.legacyCount, paired: plan.pairedCount, profiles: plan.items.length, fields })}
            </p>
            {plan.unmatched.length > 0 && <p className="text-fg-muted text-sm">{t('legacyProfiles.unmatched', { count: plan.unmatched.length })}</p>}
            {plan.ambiguousCount > 0 && <p className="text-fg-muted text-sm">{t('legacyProfiles.ambiguous', { count: plan.ambiguousCount })}</p>}
            {plan.items.length === 0 ? (
              <div className={`${cardClass} text-center text-fg-muted`} data-testid="legacy-plan-empty">{t('legacyProfiles.nothing')}</div>
            ) : (
              <>
                <div className="bg-surface border border-border rounded-lg overflow-x-auto">
                  <table className="w-full" data-testid="legacy-plan">
                    <caption className="sr-only">{t('legacyProfiles.caption')}</caption>
                    <thead className="border-b border-border">
                      <tr>
                        <th className={thClass} scope="col">{t('legacyProfiles.colProfile')}</th>
                        <th className={thClass} scope="col">{t('legacyProfiles.colLegacy')}</th>
                        <th className={thClass} scope="col">{t('legacyProfiles.colField')}</th>
                        <th className={thClass} scope="col">{t('legacyProfiles.colNow')}</th>
                        <th className={thClass} scope="col">{t('legacyProfiles.colNew')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.items.flatMap((item) =>
                        item.changes.map((change, i) => (
                          <tr key={`${item.id}-${change.field}`} className="border-b border-border last:border-0" data-profile-id={item.id} data-field={change.field}>
                            <td className={tdClass} dir="ltr">
                              {i === 0 && (
                                <>
                                  <div>{item.id}</div>
                                  <div className="text-fg-muted text-xs" data-testid="legacy-plan-email">{item.email}</div>
                                </>
                              )}
                            </td>
                            <td className={tdClass} dir="ltr">{i === 0 ? item.legacyId : ''}</td>
                            <td className={tdClass} dir="ltr"><code>{change.field}</code></td>
                            <td className={`${tdClass} text-fg-muted break-all`} dir="auto">{show(change.from) || t('legacyProfiles.empty')}</td>
                            <td className={`${tdClass} text-fg break-all`} dir="auto" data-testid="legacy-plan-to">{show(change.to)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
                {!running && <LegacyRestoreRun profiles={plan.items.length} fields={fields} />}
              </>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="legacy-runs" className="space-y-3">
        <h2 id="legacy-runs" className="text-xl font-semibold text-fg">{t('legacyProfiles.jobsTitle')}</h2>
        {!jobs && <ErrorAlert testId="legacy-jobs-error">{t('legacyProfiles.loadFailed')}</ErrorAlert>}
        {jobs && jobs.length === 0 && <div className={`${cardClass} text-center text-fg-muted`} data-testid="legacy-jobs-empty">{t('legacyProfiles.jobsEmpty')}</div>}
        {jobs && jobs.length > 0 && (
          <div className="bg-surface border border-border rounded-lg overflow-x-auto">
            <table className="w-full" data-testid="legacy-jobs">
              <caption className="sr-only">{t('legacyProfiles.jobsCaption')}</caption>
              <thead className="border-b border-border">
                <tr>
                  <th className={thClass} scope="col">{t('legacyProfiles.colWhen')}</th>
                  <th className={thClass} scope="col">{t('legacyProfiles.colStatus')}</th>
                  <th className={thClass} scope="col">{t('legacyProfiles.colResult')}</th>
                  <th className={thClass} scope="col">{t('legacyProfiles.colBy')}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const result = job.result as Partial<LegacyRestoreResult> | null;
                  const written = result?.written ?? [];
                  const skipped = result?.skipped ?? [];
                  return (
                    <tr key={job.id} className="border-b border-border last:border-0" data-job-id={job.id} data-status={job.status}>
                      <td className={tdClass}>{formatDate(job.createdAt, locale, true)}</td>
                      <td className={tdClass}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span data-testid="legacy-job-status">{t(JOB_STATUS_LABEL[job.status])}</span>
                          {job.status === 'failed' && <JobRetry id={job.id} />}
                        </div>
                        {job.lastError && <div className="text-danger-fg text-xs mt-1 break-words">{job.lastError}</div>}
                      </td>
                      <td className={tdClass}>
                        {result && <div data-testid="legacy-job-result">{t('legacyProfiles.result', { written: written.length, skipped: skipped.length })}</div>}
                        {written.map((w) => (
                          <div key={w.id} className="text-fg-muted text-xs" dir="ltr">{w.id}: {w.fields.join(', ')}</div>
                        ))}
                        {skipped.map((s) => (
                          <div key={s.id} className="text-fg-muted text-xs" dir="ltr">{t('legacyProfiles.skippedBecause', { id: s.id, reason: s.reason })}</div>
                        ))}
                        {written.length > 0 && <div className="text-fg-muted text-xs">{t('legacyProfiles.backups', { count: written.length })}</div>}
                      </td>
                      <td className={tdClass} dir="ltr">{job.actorId}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
