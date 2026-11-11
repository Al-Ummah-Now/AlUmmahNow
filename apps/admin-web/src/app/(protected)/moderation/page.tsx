import Link from '@/components/AppLink';
import { listReports } from '@/lib/api/admin';
import type { ListReportsResponse } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import { formatDate, translateDynamic } from '@/i18n/translate';
import { ErrorAlert, StatusChip, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { FilterBar } from './FilterBar';
import { PAGE_SIZE, moderationHref, parseModerationFilters } from './filters';
import { LiveRefresh } from '@/components/LiveRefresh';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const thClass = 'text-start px-4 sm:px-6 py-3 text-fg-muted font-medium whitespace-nowrap';
const pagerClass =
  'px-4 py-2 bg-surface border border-border text-fg rounded hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

export default async function ModerationPage({ searchParams }: PageProps) {
  const filters = parseModerationFilters(await searchParams);
  const { t, locale } = await getI18n();
  const { page } = filters;

  let data: ListReportsResponse | null = null;
  let failed = false;

  try {
    data = await listReports({
      status: filters.status,
      entity_type: filters.entity_type,
      entity_id: filters.entity_id,
      reporter_id: filters.reporter_id,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
  } catch (e) {
    failed = true;
    logger.error('[moderation] Failed to load reports', { error: e instanceof Error ? e.message : String(e) });
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 0;

  return (
    <div>
      <LiveRefresh topics={['moderation']} queues={['reports']} />
      <div className="flex flex-wrap justify-between items-end gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-fg">{t('moderation.title')}</h1>
          {data && (
            <p className="text-fg-muted mt-1" data-testid="reports-total" data-total={data.total}>
              {t('moderation.totalCount', { count: data.total })}
            </p>
          )}
        </div>
        <FilterBar status={filters.status} entityType={filters.entity_type} entityId={filters.entity_id} reporterId={filters.reporter_id} />
      </div>

      {failed && <ErrorAlert testId="reports-error">{t('errors.loadReports')}</ErrorAlert>}

      {data && data.reports.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-8 text-center text-fg-muted" data-testid="reports-empty">
          {t('moderation.noReports')}
        </div>
      )}

      {data && data.reports.length > 0 && (
        <>
          <div className="bg-surface border border-border rounded-lg overflow-x-auto">
            <table className="w-full" data-testid="reports-table">
              <caption className="sr-only">{t('moderation.tableCaption')}</caption>
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className={thClass}>{t('moderation.colType')}</th>
                  <th scope="col" className={thClass}>{t('moderation.colReason')}</th>
                  <th scope="col" className={thClass}>{t('moderation.colStatus')}</th>
                  <th scope="col" className={thClass}>{t('moderation.colDate')}</th>
                  <th scope="col" className={thClass}>{t('moderation.colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.reports.map((report) => (
                  <tr key={report.id} className="hover:bg-surface-hover" data-testid="report-row" data-report-id={report.id}>
                    <td className="px-4 sm:px-6 py-4">
                      <span className="text-fg">{translateDynamic(t, 'entityType', report.entity_type)}</span>
                      <span className="block text-xs text-fg-subtle font-mono" dir="ltr">
                        {report.entity_id.length > 12 ? `${report.entity_id.slice(0, 12)}…` : report.entity_id}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      <span className="text-fg-muted">{translateDynamic(t, 'reason', report.reason)}</span>
                      {report.description && (
                        <span className="block text-xs text-fg-subtle truncate max-w-xs">{report.description}</span>
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      <StatusChip status={report.status} label={translateDynamic(t, 'status', report.status)} />
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-fg-muted text-sm whitespace-nowrap">
                      <time dateTime={report.created_at}>{formatDate(report.created_at, locale)}</time>
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      <Link
                        href={`/moderation/reports/${encodeURIComponent(report.id)}`}
                        className={linkClass}
                        aria-label={t('moderation.viewReport', { id: report.id.slice(0, 8) })}
                      >
                        {t('moderation.view')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <nav aria-label={t('moderation.paginationLabel')} className="flex justify-center items-center gap-2 mt-6">
              {page > 1 && (
                <Link href={moderationHref({ ...filters, page: page - 1 })} className={pagerClass} rel="prev">
                  {t('moderation.previous')}
                </Link>
              )}
              <span className="px-4 py-2 text-fg-muted" data-testid="page-indicator" aria-current="page">
                {t('moderation.pageOf', { page, total: totalPages })}
              </span>
              {page < totalPages && (
                <Link href={moderationHref({ ...filters, page: page + 1 })} className={pagerClass} rel="next">
                  {t('moderation.next')}
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
