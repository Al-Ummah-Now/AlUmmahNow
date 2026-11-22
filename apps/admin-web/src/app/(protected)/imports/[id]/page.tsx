import Link from '@/components/AppLink';
import { notFound } from 'next/navigation';
import { IMPORT_ITEM_STATES, type AdminContentPermission, type ImportItemState } from '@al-ummah/shared-types';
import { getAdminSession } from '@/lib/auth';
import { canManageImports } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatNumber, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { EmptyState, MetaLine, smallButtonClass } from '@/components/content/parts';
import { hrefWith, pickParams, type SearchParams } from '@/components/content/query';
import { LocalTime } from '@/components/LocalTime';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { LiveRefresh } from '@/components/LiveRefresh';
import { ImportItems } from '@/components/imports/ImportItems';
import { getContentPermissions } from '@/lib/api/content';
import { getImportBatchPage, type ImportBatchPage } from '@/lib/api/imports';
import { AdminApiError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { BatchName } from '../BatchName';

export const dynamic = 'force-dynamic';

/**
 * One import batch (wiki TOOLS-ADMIN TA-8): its channel and who started it, the files per state, and a
 * page of its files with what became of each on the server (video, sidecars, captions). Refreshes when
 * a job changes (the attach jobs are admin jobs).
 */
export default async function ImportBatchPageView({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const query = pickParams(await searchParams, { page: 'page', state: IMPORT_ITEM_STATES });
  const page = Number(query.page ?? 1);
  const state = query.state as ImportItemState | undefined;
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canManageImports(session?.user.role)) return <ErrorAlert testId="imports-no-access">{t('content.errors.forbidden')}</ErrorAlert>;

  let data: ImportBatchPage | null = null;
  let permissions: AdminContentPermission[] = [];
  try {
    [data, permissions] = await Promise.all([getImportBatchPage(id, page, state), getContentPermissions()]);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    logger.error('[imports] Failed to load the batch', { batchId: id, error: e instanceof Error ? e.message : String(e) });
  }
  if (!data) {
    return (
      <div>
        <Link href="/imports" className={`${linkClass} text-sm`}>{t('imports.allImports')}</Link>
        <ErrorAlert testId="import-batch-error">{t('imports.loadFailed')}</ErrorAlert>
      </div>
    );
  }

  const { batch, counts } = data;
  const all = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const base = `/imports/${encodeURIComponent(batch.id)}`;
  const filters: { state?: ImportItemState; label: string; count: number }[] = [
    { label: t('imports.filterAll'), count: all },
    ...IMPORT_ITEM_STATES.filter((s) => (counts[s] ?? 0) > 0).map((s) => ({ state: s, label: t(`imports.states.${s}` as MessageKey), count: counts[s] ?? 0 })),
  ];

  return (
    <div>
      <LiveRefresh topics={['jobs']} />
      <Link href="/imports" className={`${linkClass} text-sm`} data-testid="imports-back">
        {t('imports.allImports')}
      </Link>
      <div className="mt-2 mb-6">
        <h1 className="text-3xl font-bold text-fg break-words" data-testid="import-batch-title">
          <BatchName name={batch.name} createdAt={batch.createdAt} />
        </h1>
        <MetaLine
          className="block text-fg-muted mt-1"
          parts={[
            fillNodes(t('imports.meta'), {
              channel: batch.channelName ? (
                <Link href={`/channels/${encodeURIComponent(batch.channelId)}`} className={linkClass}>
                  {batch.channelName}
                </Link>
              ) : (
                t('imports.channelGone')
              ),
              date: <LocalTime value={batch.createdAt} />,
            }),
            fillNodes(t('imports.by'), { actor: <UserName id={batch.createdBy} showEmail={false} /> }),
          ]}
        />
      </div>
      <nav aria-label={t('imports.stateFilter')} className="mb-4 flex flex-wrap gap-2" data-testid="import-state-filters">
        {filters.map((f) => {
          const active = f.state === state;
          return (
            <Link
              key={f.state ?? 'all'}
              href={hrefWith(base, { state: f.state })}
              aria-current={active ? 'page' : undefined}
              className={`px-3 py-1.5 rounded border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${active ? 'bg-surface-hover border-border text-fg font-medium' : 'border-border text-fg-muted hover:text-fg hover:bg-surface-hover'}`}
              data-testid={`import-filter-${f.state ?? 'all'}`}
            >
              {f.label}
              <span className="ms-2 tabular-nums">{formatNumber(f.count, locale)}</span>
            </Link>
          );
        })}
      </nav>
      {data.statuses === null && <ErrorAlert testId="import-status-unknown">{t('imports.statusUnknown')}</ErrorAlert>}
      {data.items.length === 0 ? (
        <EmptyState>{t('imports.empty')}</EmptyState>
      ) : (
        <ImportItems items={data.items} statuses={data.statuses} permissions={permissions} />
      )}
      {pages > 1 && (
        <nav aria-label={t('imports.pagination')} className="mt-4 flex flex-wrap items-center justify-between gap-2" data-testid="import-pages">
          {page > 1 ? (
            <Link href={hrefWith(base, { state, page: page > 2 ? String(page - 1) : undefined })} className={smallButtonClass} rel="prev">
              {t('imports.previous')}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-fg-muted">{t('imports.pageOf', { page: formatNumber(page, locale), pages: formatNumber(pages, locale) })}</span>
          {page < pages ? (
            <Link href={hrefWith(base, { state, page: String(page + 1) })} className={smallButtonClass} rel="next">
              {t('imports.next')}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
