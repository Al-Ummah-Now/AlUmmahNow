import Link from '@/components/AppLink';
import { listReports } from '@/lib/api/admin';
import type { ListReportsResponse } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import { translateDynamic } from '@/i18n/translate';
import { ErrorAlert, StatusChip, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { FilterBar } from './FilterBar';
import { PAGE_SIZE, moderationHref, parseModerationFilters } from './filters';
import { LiveRefresh } from '@/components/LiveRefresh';

import { LocalTime } from '@/components/LocalTime';
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const thClass = 'text-start px-4 sm:px-6 py-3 text-fg-muted font-medium whitespace-nowrap';
const isOpenReport = (status: string) => status === 'pending' || status === 'reviewing';
const pagerClass =
  'px-4 py-2 bg-surface border border-border text-fg rounded hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

export default async function ModerationPage({ searchParams }: PageProps) {
  const filters = parseModerationFilters(await searchParams);
  const { t } = await getI18n();
  const { page } = filters;

  let data: ListReportsResponse | null = null;
  let failed = false;

  try {
    data = await listReports({
      status: filters.status,
      entity_type: filters.entity_type,
      reason: filters.reason,
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
              {data.totalCapped ? t('moderation.totalCountCapped', { count: data.total }) : t('moderation.totalCount', { count: data.total })}
            </p>
          )}
        </div>
        <FilterBar status={filters.status} entityType={filters.entity_type} reason={filters.reason} entityId={filters.entity_id} reporterId={filters.reporter_id} />
      </div>

      {failed && <ErrorAlert testId="reports-error">{t('errors.loadReports')}</ErrorAlert>}

      {data && !!data.openChildSafety && filters.reason !== 'child_safety' && (
        <div className="bg-danger-bg border border-danger-border text-danger-fg rounded-lg p-4 mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2" role="status" data-testid="child-safety-banner" data-count={data.openChildSafety}>
          <p>
            <span className="font-semibold">{t('moderation.childSafetyOpen', { count: data.openChildSafety })}</span> {t('moderation.childSafetyFirst')}
          </p>
          <Link href={moderationHref({ reason: 'child_safety' })} className="underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded">
            {t('moderation.childSafetyShow')}
          </Link>
        </div>
      )}

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
                      <span className="block text-xs text-fg-subtle font-mono">
                        <bdi dir="ltr">{report.entity_id.length > 12 ? `${report.entity_id.slice(0, 12)}…` : report.entity_id}</bdi>
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      {report.reason === 'child_safety' ? (
                        <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-sm font-medium ${isOpenReport(report.status) ? 'bg-danger-bg border-danger-border text-danger-fg' : 'border-border text-fg-muted'}`} data-testid="child-safety-badge">
                          {translateDynamic(t, 'reason', report.reason)}
                        </span>
                      ) : (
                        <span className="text-fg-muted">{translateDynamic(t, 'reason', report.reason)}</span>
                      )}
                      {report.taken_down && (
                        <span className="block text-xs text-fg-muted max-w-xs" data-testid="report-taken-down">{t('moderation.takenDown')}</span>
                      )}
                      {report.description && (
                        <span className="block text-xs text-fg-subtle truncate max-w-xs">
                          <bdi>{report.description}</bdi>
                        </span>
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      <StatusChip status={report.status} label={translateDynamic(t, 'status', report.status)} />
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-fg-muted text-sm whitespace-nowrap">
                      <LocalTime value={report.created_at} />
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
