import Link from 'next/link';
import type { AdminCreatorsPage, CreatorTier } from '@al-ummah/shared-types';
import { listCreators, listCreatorTiers, type CreatorFilter } from '@/lib/api/creators';
import { getAdminSession } from '@/lib/auth';
import { canManageCreators } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, linkClass, secondaryButtonClass } from '@/components/ui';
import { TierSelect } from '@/components/creators/TierSelect';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const FILTERS: { value: CreatorFilter; label: MessageKey }[] = [
  { value: 'all', label: 'creators.filterAll' },
  { value: 'needs_tier', label: 'creators.filterNeedsTier' },
  { value: 'assigned', label: 'creators.filterAssigned' },
  { value: 'limited', label: 'creators.filterLimited' },
];

const thClass = 'text-start px-3 py-3 text-fg-muted font-medium whitespace-nowrap';
const tdClass = 'px-3 py-3 align-top text-sm';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/**
 * Who may upload and create channels: everyone holding a creator tier, owning
 * a channel or having uploaded. Users with content but no tier come first,
 * marked "Needs tier", with a one-click "Make Creator".
 */
export default async function CreatorsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filterParam = one(params.filter) as CreatorFilter;
  const filter: CreatorFilter = FILTERS.some((f) => f.value === filterParam) ? filterParam : 'all';
  const q = one(params.q).trim();
  const page = Math.max(1, Number(one(params.page)) || 1);
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  const canManage = canManageCreators(session?.user.role);

  let data: AdminCreatorsPage | null = null;
  let tiers: CreatorTier[] = [];
  try {
    [data, tiers] = await Promise.all([listCreators({ q, filter, page }), listCreatorTiers()]);
  } catch (e) {
    logger.error('[creators] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }
  const tierOptions = tiers.map((tier) => ({ id: tier.id, name: tier.name }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hrefFor = (next: Record<string, string | number>) => {
    const query = new URLSearchParams({ ...(q ? { q } : {}), ...(filter !== 'all' ? { filter } : {}) });
    for (const [k, v] of Object.entries(next)) query.set(k, String(v));
    return `/creators?${query}`;
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-fg">{t('creators.title')}</h1>
          <p className="text-fg-muted mt-1 max-w-3xl">{t('creators.subtitle')}</p>
        </div>
        <Link href="/creators/tiers" className={linkClass} data-testid="creators-tiers-link">{t('creators.tiersLink')}</Link>
      </div>

      {!data && <ErrorAlert testId="creators-load-failed">{t('creators.loadFailed')}</ErrorAlert>}

      {data && data.limitHits24h > 0 && (
        <div role="status" data-testid="creators-notice-limited" className="mb-4 rounded border border-border border-s-4 border-s-accent bg-surface px-4 py-3 text-sm text-fg">
          {t('creators.noticeLimited', { count: data.limitHits24h })}{' '}
          <Link href="/creators?filter=limited" className={linkClass}>{t('creators.noticeLimitedLink')}</Link>
        </div>
      )}
      {data && data.needsTier > 0 && (
        <div role="status" data-testid="creators-notice-needs-tier" className="mb-4 rounded border border-border border-s-4 border-s-accent bg-surface px-4 py-3 text-sm text-fg">
          {t('creators.noticeNeedsTier', { count: data.needsTier })}{' '}
          <Link href="/creators?filter=needs_tier" className={linkClass}>{t('creators.noticeNeedsTierLink')}</Link>
        </div>
      )}

      <form method="get" className="mb-6 flex flex-wrap items-end gap-2" data-testid="creators-filter">
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          {t('creators.search')}
          <input name="q" defaultValue={q} className={`${fieldClass} min-w-64`} data-testid="creators-search" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          {t('creators.filterLabel')}
          <select name="filter" defaultValue={filter} className={fieldClass} data-testid="creators-filter-select">
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{t(f.label)}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={secondaryButtonClass}>{t('creators.apply')}</button>
      </form>

      {!canManage && <p className="mb-4 text-sm text-fg-muted" data-testid="creators-read-only">{t('creators.noAccess')}</p>}
      <p className="mb-4 text-sm text-fg-muted">{t('creators.superAdminNote')}</p>

      {data && (
        <div className={`${cardClass} p-0 overflow-x-auto`}>
          <table className="w-full" data-testid="creators-table">
            <caption className="sr-only">{t('creators.tableCaption')}</caption>
            <thead className="border-b border-border">
              <tr>
                <th scope="col" className={thClass}>{t('creators.colUser')}</th>
                <th scope="col" className={thClass}>{t('creators.colTier')}</th>
                <th scope="col" className={thClass}>{t('creators.colChannels')}</th>
                <th scope="col" className={thClass}>{t('creators.colVideos')}</th>
                <th scope="col" className={thClass}>{t('creators.colUsage')}</th>
                <th scope="col" className={thClass}>{t('creators.colHits')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className={`${tdClass} text-fg-muted`}>{t('creators.empty')}</td>
                </tr>
              )}
              {data.items.map((row) => (
                <tr key={row.userId} className="border-b border-border last:border-0" data-testid="creator-row" data-user-id={row.userId} data-needs-tier={row.needsTier ? 'true' : 'false'}>
                  <td className={tdClass}>
                    <div className="font-medium text-fg">{row.displayName || row.userName || row.userId}</div>
                    {row.email && <div className="text-fg-muted" dir="ltr">{row.email}</div>}
                    <div className="text-xs text-fg-muted" dir="ltr">{row.userId}</div>
                    <Link href={`/auth-requests/users/${encodeURIComponent(row.userId)}`} className={`${linkClass} text-xs`}>{t('creators.viewUser')}</Link>
                  </td>
                  <td className={tdClass}>
                    {row.needsTier && (
                      <span data-testid="creator-needs-tier" className="mb-2 inline-block rounded-full bg-chip-pending-bg px-2 py-0.5 text-xs font-medium text-chip-pending-fg">
                        {t('creators.needsTier')}
                      </span>
                    )}
                    <TierSelect userId={row.userId} tierId={row.assignment?.tierId ?? null} tiers={tierOptions} canManage={canManage} needsTier={row.needsTier} />
                  </td>
                  <td className={tdClass}>{row.channels}</td>
                  <td className={tdClass}>{row.videos}</td>
                  <td className={tdClass} dir="ltr">{row.usage.hour} / {row.usage.day}</td>
                  <td className={tdClass}>
                    <span className={row.limitHits7d > 0 ? 'font-semibold text-warning-fg' : ''}>{row.limitHits7d}</span>
                    {row.lastLimitHitAt && <div className="text-xs text-fg-muted">{t('creators.lastHit', { date: formatDate(row.lastLimitHitAt, locale, true) })}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && pages > 1 && (
        <nav className="mt-4 flex items-center gap-4 text-sm" aria-label={t('creators.tableCaption')}>
          {page > 1 && <Link className={linkClass} href={hrefFor({ page: page - 1 })}>{t('creators.previous')}</Link>}
          <span className="text-fg-muted">{t('creators.pageOf', { page, pages })}</span>
          {page < pages && <Link className={linkClass} href={hrefFor({ page: page + 1 })}>{t('creators.next')}</Link>}
        </nav>
      )}
    </div>
  );
}
