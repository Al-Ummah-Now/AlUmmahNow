import { PriorityTabs } from '@/components/PriorityTabs';
import { formatNumber } from '@/i18n/translate';
import { ADMIN_JOB_STATUSES } from '@al-ummah/shared-types';
import { getContentPermissions, getJobCounts, listJobs } from '@/lib/api/content';
import type { AdminContentPermission, AdminJob, JobCounts } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { EmptyState, PageHeader } from '@/components/content/parts';
import { JobsTable } from '@/components/content/jobs';
import { pickParams, type SearchParams } from '@/components/content/query';
import { logger } from '@/lib/logger';
import { LiveRefresh } from '@/components/LiveRefresh';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { status: 'failed', label: 'jobs.filterFailed' },
  { status: 'retrying', label: 'jobs.statuses.retrying' },
  { status: 'queued', label: 'jobs.statuses.queued' },
  { status: 'running', label: 'jobs.statuses.running' },
  { status: 'succeeded', label: 'jobs.filterDone' },
  { status: 'cancelled', label: 'jobs.statuses.cancelled' },
  { status: undefined, label: 'jobs.filterAll' },
] as const;

/**
 * Admin jobs: heavy actions (deletes, suspend and ban cascades, transfers,
 * moves) run from a queue with retries. Failed ones are listed first so an
 * admin can retry them; they also show on the Errors page and on the item.
 * Each job shows attempts n/max, its next try, its last error in plain words
 * and its log; Cancel stops one that has not finished (TA-8).
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const params = pickParams(raw, { status: [...ADMIN_JOB_STATUSES, 'all'] });
  // Failed first: that is what needs an admin
  const status = params.status === 'all' ? undefined : (params.status ?? 'failed');
  const { t, locale } = await getI18n();

  let jobs: AdminJob[] | null = null;
  let counts: JobCounts | null = null;
  let permissions: AdminContentPermission[] = [];
  try {
    [jobs, counts, permissions] = await Promise.all([listJobs({ status, limit: 100 }), getJobCounts(), getContentPermissions()]);
  } catch (e) {
    logger.error('[jobs] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div>
      <LiveRefresh topics={['jobs']} />
      <PageHeader locale={locale} title={t('jobs.title')} subtitle={t('jobs.subtitle')} t={t} />
      <PriorityTabs
        label={t('jobs.statusFilter')}
        testId="jobs-filters"
        className="mb-6 border-b border-border"
        rowClassName="gap-1"
        tabClassName="inline-flex items-center gap-2 whitespace-nowrap px-3 py-2 -mb-px border-b-2 text-sm font-medium rounded-t focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        currentClassName="border-accent text-fg"
        idleClassName="border-transparent text-fg-muted hover:text-fg hover:border-border"
        tabs={FILTERS.map((f) => {
          const count = f.status === 'failed' ? counts?.failed : f.status === 'retrying' ? counts?.retrying : undefined;
          return {
            id: f.status ?? 'all',
            label: t(f.label),
            href: f.status ? `/jobs?status=${f.status}` : '/jobs?status=all',
            current: f.status === status,
            extra: count ? <span className="tabular-nums" data-testid={`jobs-count-${f.status}`}>{formatNumber(count, locale)}</span> : undefined,
          };
        })}
      />
      {!jobs && <ErrorAlert testId="jobs-error">{t('content.loadFailed')}</ErrorAlert>}
      {jobs && jobs.length === 0 && <EmptyState>{status === 'failed' ? t('jobs.emptyFailed') : t('jobs.empty')}</EmptyState>}
      {jobs && jobs.length > 0 && <JobsTable jobs={jobs} permissions={permissions} />}
    </div>
  );
}
