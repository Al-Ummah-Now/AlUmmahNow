import Link from '@/components/AppLink';
import { NO_CREATOR_TIER, type AdminCreatorsPage, type CreatorTiersList } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { formatNumber, type MessageKey, type Translator } from '@/i18n/translate';
import { creatorsHref, type CreatorsQuery } from '@/lib/creator-tiers';
import { ErrorAlert, fieldClass, linkClass, secondaryButtonClass } from '@/components/ui';
import { Autocomplete } from '@/components/search/Autocomplete';
import { PageHeader, Pager } from '@/components/content/parts';
import { CreatorsTable, type CreatorsTableProps } from './CreatorsTable';
import { LimitHitsNotice } from './LimitHitsNotice';

const FILTERS: { value: string; label: MessageKey }[] = [
  { value: 'all', label: 'creators.filterAll' },
  { value: 'needs_tier', label: 'creators.filterNeedsTier' },
  { value: 'assigned', label: 'creators.filterAssigned' },
  { value: 'limited', label: 'creators.filterLimited' },
];

const PAGE_SIZE = 50;

export interface CreatorsViewProps extends Pick<CreatorsTableProps, 'setTier' | 'bulkSetTier'> {
  /** null: the list could not be loaded */
  data: AdminCreatorsPage | null;
  tiers: CreatorTiersList | null;
  query: CreatorsQuery;
  canManage: boolean;
  t: Translator;
  locale: Locale;
}

/** The Creators page body: notices, search and filters, the table and its pages. */
export function CreatorsView({ data, tiers, query, canManage, t, locale, setTier, bulkSetTier }: CreatorsViewProps) {
  const n = (value: number) => formatNumber(value, locale);

  return (
    <div>
      <PageHeader title={t('creators.title')} subtitle={t('creators.subtitle')} t={t}>
        <Link href="/creators/tiers" className={linkClass} data-testid="creators-tiers-link">{t('creators.tiersLink')}</Link>
      </PageHeader>

      {(!data || !tiers) && <ErrorAlert testId="creators-load-failed">{t('creators.loadFailed')}</ErrorAlert>}

      {data && <LimitHitsNotice count={data.limitHits7d} t={t} locale={locale} />}
      {data && data.needsTier > 0 && (
        <div role="status" data-testid="creators-notice-needs-tier" className="mb-4 rounded border border-border border-s-4 border-s-accent bg-surface px-4 py-3 text-sm text-fg">
          {t('creators.noticeNeedsTier', { count: n(data.needsTier) })}{' '}
          <Link href="/creators?filter=needs_tier" className={`${linkClass} underline`}>{t('creators.noticeNeedsTierLink')}</Link>
        </div>
      )}

      <form method="get" action="/creators" className="mb-4 flex flex-wrap items-end gap-2" data-testid="creators-filter">
        <Autocomplete kind="user" mode="search" name="q" label={t('creators.search')} defaultValue={query.q ?? ''} className="min-w-64" testId="creators-search" />
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          {t('creators.tierFilter')}
          <select name="tier" defaultValue={query.tier} className={fieldClass} data-testid="creators-tier-select">
            <option value="">{t('creators.tierAny')}</option>
            <option value={NO_CREATOR_TIER}>{t('creators.tierNoneCount', { count: n(tiers?.counts.none ?? 0) })}</option>
            {tiers?.items.map((tier) => (
              <option key={tier.id} value={tier.id}>{t('creators.tierWithCount', { name: tier.name, count: n(tiers?.counts.byTier[tier.id] ?? 0) })}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          {t('creators.filterLabel')}
          <select name="filter" defaultValue={query.filter} className={fieldClass} data-testid="creators-filter-select">
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{t(f.label)}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={secondaryButtonClass}>{t('creators.apply')}</button>
        {(query.q || query.tier || query.filter !== 'all') && (
          <Link href="/creators" className={`${linkClass} text-sm self-center`} data-testid="creators-clear">{t('creators.clear')}</Link>
        )}
      </form>

      <p className="mb-4 text-sm text-fg-muted">
        {t('creators.superAdminNote')}
        {!canManage && <span className="block" data-testid="creators-read-only">{t('creators.noAccess')}</span>}
      </p>
      {data && <p className="mb-2 text-sm text-fg-muted" data-testid="creators-total">{t('creators.total', { count: n(data.total) })}</p>}

      {data && tiers && <CreatorsTable items={data.items} tiers={tiers.items} canManage={canManage} setTier={setTier} bulkSetTier={bulkSetTier} />}
      {data && <Pager page={data.page} pageSize={data.pageSize || PAGE_SIZE} total={data.total} href={(page) => creatorsHref(query, { page })} t={t} />}
    </div>
  );
}
