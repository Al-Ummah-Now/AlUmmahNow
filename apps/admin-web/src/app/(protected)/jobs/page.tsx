import Link from 'next/link';
import { ADMIN_JOB_STATUSES } from '@al-ummah/shared-types';
import { getContentPermissions, getJobCounts, listJobsPage } from '@/lib/api/content';
import type { AdminContentPermission, AdminJob, JobCounts } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { CursorPager, EmptyState, PageHeader } from '@/components/content/parts';
import { JobsTable } from '@/components/content/jobs';
import { hrefWith, pickParams, type SearchParams } from '@/components/content/query';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { status: 'failed', label: 'jobs.filterFailed' },
  { status: 'retrying', label: 'jobs.statuses.retrying' },
  { status: 'queued', label: 'jobs.statuses.queued' },
  { status: 'running', label: 'jobs.statuses.running' },
  { status: 'succeeded', label: 'jobs.filterDone' },
  { status: undefined, label: 'jobs.filterAll' },
] as const;

/**
 * Admin jobs: heavy actions (deletes, suspend and ban cascades, transfers,
 * moves) run from a queue with retries. Failed ones are listed first so an
 * admin can retry them; they also show on the Errors page and on the item.
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const params = pickParams(raw, { status: [...ADMIN_JOB_STATUSES, 'all'], cursor: 'cursor' });
  // Failed first: that is what needs an admin
  const status = params.status === 'all' ? undefined : (params.status ?? 'failed');
  const { t } = await getI18n();

  let jobs: AdminJob[] | null = null;
  let nextCursor = '';
  let counts: JobCounts | null = null;
  let permissions: AdminContentPermission[] = [];
  try {
    let page: { items: AdminJob[]; cursor: string };
    [page, counts, permissions] = await Promise.all([listJobsPage({ status, limit: 50, cursor: params.cursor }), getJobCounts(), getContentPermissions()]);
    jobs = page.items;
    nextCursor = page.cursor;
  } catch (e) {
    logger.error('[jobs] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div>
      <PageHeader title={t('jobs.title')} subtitle={t('jobs.subtitle')} t={t} />
      <nav aria-label={t('jobs.statusFilter')} className="mb-6 flex flex-wrap gap-2" data-testid="jobs-filters">
        {FILTERS.map((f) => {
          const active = f.status === status;
          const href = f.status ? `/jobs?status=${f.status}` : '/jobs?status=all';
          const count = f.status === 'failed' ? counts?.failed : f.status === 'retrying' ? counts?.retrying : undefined;
          return (
            <Link
              key={f.label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`px-3 py-1.5 rounded border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${active ? 'bg-surface-hover border-border text-fg font-medium' : 'border-border text-fg-muted hover:text-fg hover:bg-surface-hover'}`}
            >
              {t(f.label)}
              {count !== undefined && count > 0 && <span className="ms-2 tabular-nums" data-testid={`jobs-count-${f.status}`}>{count}</span>}
            </Link>
          );
        })}
      </nav>
      {!jobs && <ErrorAlert testId="jobs-error">{t('content.loadFailed')}</ErrorAlert>}
      {jobs && jobs.length === 0 && <EmptyState>{status === 'failed' ? t('jobs.emptyFailed') : t('jobs.empty')}</EmptyState>}
      {jobs && jobs.length > 0 && <JobsTable jobs={jobs} permissions={permissions} />}
      {jobs && (
        <CursorPager
          hasCursor={!!params.cursor}
          nextHref={nextCursor ? hrefWith('/jobs', { status: params.status }, { cursor: nextCursor }) : null}
          firstHref={hrefWith('/jobs', { status: params.status })}
          labels={{ first: t('content.firstPage'), next: t('content.nextPage') }}
          t={t}
        />
      )}
    </div>
  );
}
