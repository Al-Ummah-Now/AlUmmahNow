import Link from '@/components/AppLink';
import { redirect } from 'next/navigation';
import { findErrorRef, getErrorCounts, getErrorFacets, listErrorGroups } from '@/lib/api/admin';
import type { ErrorCounts, ErrorFacets, ErrorGroupList } from '@/lib/api/error-groups-types';
import { getAdminSession } from '@/lib/auth';
import { canReadErrors, canReadOps, canUseProcessing } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, formatNumber, translateDynamic } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { ErrorFilterBar } from './ErrorFilterBar';
import { FailuresSections, hasFailures, loadFailures } from './FailuresSections';
import { ERRORS_PAGE_SIZE, errorGroupsQuery, errorsHref, hasErrorFilters, parseErrorFilters, searchedRef } from './filters';
import { ErrorStatusChip, Sparkline, TestChip, errorTitle } from './ui';
import { LiveRefresh } from '@/components/LiveRefresh';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const thClass = 'text-start px-4 py-3 text-fg-muted font-medium whitespace-nowrap';
const pagerClass =
  'px-4 py-2 bg-surface border border-border text-fg rounded hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
const tabClass = 'inline-flex items-center gap-2 px-4 py-2 -mb-px border-b-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-t';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default async function ErrorsPage({ searchParams }: PageProps) {
  const filters = parseErrorFilters(await searchParams);
  const { t, locale } = await getI18n();
  const session = await getAdminSession();

  const role = session?.user.role;
  const readErrors = canReadErrors(role);
  if (!readErrors && !canUseProcessing(role)) {
    return <ErrorAlert testId="errors-no-access">{t('errorsPage.noAccess')}</ErrorAlert>;
  }

  // Without errors:read (videos:processing only) the page is just the failed uploads and processing checks
  if (!readErrors) {
    const failures = await loadFailures(role);
    return (
      <div className="space-y-8">
        <LiveRefresh topics={['uploads']} />
        <div>
          <h1 className="text-3xl font-bold text-fg">{t('errorsPage.title')}</h1>
          <p className="text-fg-muted mt-1">{t('errorsPage.subtitle')}</p>
        </div>
        <FailuresSections failures={failures} t={t} locale={locale} />
      </div>
    );
  }

  // A pasted reference (ERR-XXXX-XXXX) jumps straight to its group
  const ref = searchedRef(filters);
  let refMissing = false;
  if (ref) {
    let groupId: string | null = null;
    try {
      groupId = await findErrorRef(ref);
    } catch (e) {
      logger.warn('[errors] Reference lookup failed', { ref, error: errText(e) });
    }
    if (groupId) redirect(`/errors/${encodeURIComponent(groupId)}?ref=${encodeURIComponent(ref)}`);
    refMissing = true;
  }

  const [data, counts, facets, failures] = await Promise.all([
    listErrorGroups(errorGroupsQuery(filters)).catch((e): ErrorGroupList | null => {
      logger.error('[errors] Failed to load groups', { error: errText(e) });
      return null;
    }),
    getErrorCounts().catch((): ErrorCounts | null => null),
    getErrorFacets().catch((): ErrorFacets | null => null),
    // Needs action also lists failed uploads, processing checks and Contact us emails
    filters.needsAction ? loadFailures(role) : Promise.resolve(null),
  ]);
  const otherFailures = !!failures && hasFailures(failures);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / ERRORS_PAGE_SIZE)) : 0;
  const openActions = counts?.openActions ?? 0;

  return (
    <div>
      <LiveRefresh topics={['errors', 'uploads']} />
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('errorsPage.title')}</h1>
        <p className="text-fg-muted mt-1">
          {t('errorsPage.subtitle')}
          {data && (
            <span data-testid="errors-total" data-total={data.total}>
              {' · '}
              {t('errorsPage.totalCount', { count: data.total })}
            </span>
          )}
        </p>
        {canReadOps(role) && (
          <p className="mt-1 text-sm">
            <Link href="/operations" className={linkClass} data-testid="errors-operations-link">{t('operations.openLink')}</Link>
          </p>
        )}
      </div>

      <nav aria-label={t('errorsPage.tabsLabel')} className="flex gap-2 border-b border-border mb-6">
        <Link
          href={errorsHref({ ...filters, needsAction: false, page: 1 })}
          aria-current={!filters.needsAction ? 'page' : undefined}
          className={`${tabClass} ${!filters.needsAction ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}
          data-testid="errors-tab-all"
        >
          {t('errorsPage.tabAll')}
          {counts && counts.new > 0 && <span className="text-xs rounded-full bg-surface-2 border border-border px-2">{formatNumber(counts.new, locale)}</span>}
        </Link>
        <Link
          href={errorsHref({ ...filters, needsAction: true, page: 1 })}
          aria-current={filters.needsAction ? 'page' : undefined}
          className={`${tabClass} ${filters.needsAction ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}
          data-testid="errors-tab-needs-action"
          data-count={openActions}
        >
          {t('errorsPage.tabNeedsAction')}
          {openActions > 0 && <span className="text-xs rounded-full bg-accent text-on-accent px-2">{formatNumber(openActions, locale)}</span>}
        </Link>
      </nav>

      <div className="mb-6">
        <ErrorFilterBar filters={filters} facets={facets} active={hasErrorFilters(filters)} />
      </div>

      {refMissing && ref && (
        <div role="status" className="bg-surface-2 border border-border text-fg px-4 py-3 rounded mb-6" data-testid="errors-ref-missing">
          {t('errorsPage.refNotFound', { ref })}
        </div>
      )}

      {!data && <ErrorAlert testId="errors-error">{t('errorsPage.loadFailed')}</ErrorAlert>}

      {data && data.groups.length === 0 && !(filters.needsAction && otherFailures && !hasErrorFilters(filters)) && (
        <div className="bg-surface border border-border rounded-lg p-8 text-center text-fg-muted" data-testid="errors-empty">
          {filters.needsAction && !hasErrorFilters(filters) ? t('errorsPage.emptyNeedsAction') : t('errorsPage.empty')}
        </div>
      )}

      {data && data.groups.length > 0 && (
        <>
          <div className="bg-surface border border-border rounded-lg overflow-x-auto">
            <table className="w-full" data-testid="errors-table">
              <caption className="sr-only">{t('errorsPage.tableCaption')}</caption>
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className={thClass}>{t('errorsPage.colError')}</th>
                  <th scope="col" className={thClass}>{t('errorsPage.colTrend')}</th>
                  <th scope="col" className={thClass}>{t('errorsPage.colStatus')}</th>
                  <th scope="col" className={`${thClass} text-end`}>{t('errorsPage.colEvents')}</th>
                  <th scope="col" className={`${thClass} text-end`}>{t('errorsPage.colUsers')}</th>
                  <th scope="col" className={thClass}>{t('errorsPage.colSeen')}</th>
                  <th scope="col" className={thClass}>{t('errorsPage.colRelease')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.groups.map((g) => {
                  const total14 = g.daily.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={g.id} className="hover:bg-surface-hover" data-testid="errors-row" data-group-id={g.id} data-status={g.status}>
                      <td className="px-4 py-4 align-top max-w-md">
                        <Link href={`/errors/${encodeURIComponent(g.id)}`} className={`${linkClass} font-medium`} aria-label={t('errorsPage.openGroup', { message: g.message })} data-testid="error-group-row">
                          <span className="block truncate" dir="ltr">
                            {errorTitle(g)}
                          </span>
                        </Link>
                        <span className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-fg-subtle mt-1">
                          <span className="font-mono" dir="ltr">{g.app}</span>
                          <span dir="ltr">{g.environment}</span>
                          {g.culprit && (
                            <span className="font-mono truncate max-w-xs" dir="ltr">
                              {g.culprit}
                            </span>
                          )}
                          {g.open_actions > 0 && (
                            <span className="text-danger-fg font-medium" data-testid="errors-row-open-actions">
                              {t('errorsPage.openItems', { count: g.open_actions })}
                            </span>
                          )}
                          {!!g.test && <TestChip label={t('errorsPage.test')} />}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <Sparkline values={g.daily} label={t('errorsPage.sparkline', { count: total14 })} />
                      </td>
                      <td className="px-4 py-4 align-top">
                        <ErrorStatusChip status={g.status} label={translateDynamic(t, 'errorStatus', g.status)} />
                      </td>
                      <td className="px-4 py-4 align-top text-end tabular-nums">{formatNumber(g.occurrences, locale)}</td>
                      <td className="px-4 py-4 align-top text-end tabular-nums">{formatNumber(g.users, locale)}</td>
                      <td className="px-4 py-4 align-top text-sm text-fg-muted whitespace-nowrap">
                        <time dateTime={g.first_seen} className="block">{formatDate(g.first_seen, locale, true)}</time>
                        <time dateTime={g.last_seen} className="block text-fg">{formatDate(g.last_seen, locale, true)}</time>
                      </td>
                      <td className="px-4 py-4 align-top text-sm font-mono text-fg-muted" dir="ltr">
                        {g.last_release ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <nav aria-label={t('errorsPage.paginationLabel')} className="flex justify-center items-center gap-2 mt-6">
              {filters.page > 1 && (
                <Link href={errorsHref({ ...filters, page: filters.page - 1 })} className={pagerClass} rel="prev">
                  {t('errorsPage.previous')}
                </Link>
              )}
              <span className="px-4 py-2 text-fg-muted" aria-current="page">
                {t('errorsPage.pageOf', { page: filters.page, total: totalPages })}
              </span>
              {filters.page < totalPages && (
                <Link href={errorsHref({ ...filters, page: filters.page + 1 })} className={pagerClass} rel="next">
                  {t('errorsPage.next')}
                </Link>
              )}
            </nav>
          )}
        </>
      )}
      {failures && (
        <div className="space-y-8 mt-8">
          <FailuresSections failures={failures} t={t} locale={locale} />
        </div>
      )}
    </div>
  );
}
