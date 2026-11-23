import Link from '@/components/AppLink';
import { ADMIN_USER_SORTS, type AdminUsersPage, type CreatorTier } from '@al-ummah/shared-types';
import { listUsers } from '@/lib/api/content';
import { bulkSetCreatorTier, listCreatorTierChoices, setUserCreatorTier } from '@/lib/api/creators';
import { getAdminSession } from '@/lib/auth';
import { canManageCreators } from '@/lib/roles';
import { parseUserTierFilter, tierLabel } from '@/lib/creator-tiers';
import { getI18n } from '@/i18n/server';
import { formatNumber } from '@/i18n/translate';
import { ErrorAlert, linkClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { FilterForm } from '@/components/content/FilterForm';
import { EmptyState, Notice, PageHeader, Pager } from '@/components/content/parts';
import { PAGE_SIZE, hrefWith, pickParams, type SearchParams } from '@/components/content/query';
import { LimitHitsNotice } from '@/components/creators/LimitHitsNotice';
import { UsersTable } from '@/components/users/UsersTable';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Videos users: Al Ummah Now videos profiles (api-videos), keyed by the usr_ id. Not Auth accounts.
 * Each row carries the user's creator tier (what lets them upload), with a tier filter (needs a
 * tier, has one, hit a limit, none, one tier) and, with creators:manage, a bulk tier change.
 */
export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = pickParams(await searchParams, { q: 'text', banned: ['yes', 'no'], tier: 'text', sort: ADMIN_USER_SORTS, page: 'page' });
  const tierFilter = parseUserTierFilter(params.tier);
  if (tierFilter) params.tier = tierFilter;
  else delete params.tier;
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  const canManage = canManageCreators(session?.user.role);
  const page = Number(params.page ?? 1);
  const n = (value: number) => formatNumber(value, locale);

  let data: AdminUsersPage | null = null;
  // Definitions only (no per-tier counts: those scan every profile; the Tiers page shows them)
  let tiers: CreatorTier[] | null = null;
  try {
    let choices: { items: CreatorTier[]; defaultTierId: string } | null;
    [data, choices] = await Promise.all([
      listUsers({ ...params, page, pageSize: PAGE_SIZE }),
      listCreatorTierChoices().catch((e) => {
        logger.warn('[users] Could not load tier definitions', { error: e instanceof Error ? e.message : String(e) });
        return null;
      }),
    ]);
    tiers = choices?.items ?? null;
  } catch (e) {
    logger.error('[users] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div>
      <PageHeader locale={locale} deletedKind="user" title={t('users.title')} subtitle={t('users.subtitle')} total={data?.total} t={t}>
        <div className="flex flex-wrap gap-2">
          <Link href="/users/invites" className={secondaryButtonClass} data-testid="users-invites-link">{t('invites.listLink')}</Link>
          <Link href="/users/invites/new" className={primaryButtonClass} data-testid="users-invite-new">{t('invites.inviteButton')}</Link>
        </div>
      </PageHeader>
      {data?.creators && <LimitHitsNotice count={data.creators.limitHits7d} t={t} locale={locale} />}
      {data?.creators && data.creators.needsTier > 0 && (
        <div role="status" data-testid="users-notice-needs-tier" className="mb-4 rounded border border-border border-s-4 border-s-accent bg-surface px-4 py-3 text-sm text-fg">
          {data.creators.needsTier === 1 ? t('creators.noticeNeedsTierOne') : t('creators.noticeNeedsTier', { count: n(data.creators.needsTier) })}{' '}
          <Link href="/users?tier=needs_tier" className={`${linkClass} underline`} data-testid="users-notice-needs-tier-link">{t('creators.noticeNeedsTierLink')}</Link>
        </div>
      )}
      <FilterForm
        action="/users"
        label={t('users.title')}
        testId="users-filters"
        values={params}
        fields={[
          { kind: 'search', name: 'q', label: t('users.searchLabel'), suggest: 'user' },
          { kind: 'select', name: 'banned', label: t('users.status'), options: [{ value: 'yes', label: t('users.banned') }, { value: 'no', label: t('users.notBanned') }] },
          {
            kind: 'select',
            name: 'tier',
            label: t('creators.tierFilter'),
            allLabel: t('creators.tierAny'),
            options: [
              { value: 'needs_tier', label: t('creators.filterNeedsTier') },
              { value: 'hit_limit', label: t('creators.filterLimited') },
              ...(tiers ?? []).map((tier) => ({ value: tier.id, label: tierLabel(tier, locale) })),
            ],
          },
          { kind: 'select', name: 'sort', label: t('content.sort'), allLabel: t('users.sortNewest'), options: [{ value: 'oldest', label: t('users.sortOldest') }, { value: 'name', label: t('users.sortName') }] },
        ]}
      />
      {!data && <ErrorAlert testId="users-error">{t('content.loadFailed')}</ErrorAlert>}
      {data && !data.indexComplete && <Notice tone="warn">{t('content.indexBuilding')}</Notice>}
      {data && !canManage && <p className="mb-4 text-sm text-fg-muted" data-testid="users-tier-read-only">{t('creators.noAccess')}</p>}
      {data && data.items.length === 0 && <EmptyState>{t('content.empty')}</EmptyState>}
      {data && data.items.length > 0 && (
        <>
          <UsersTable items={data.items} tiers={tiers} canManage={canManage} setTier={setUserCreatorTier} bulkSetTier={bulkSetCreatorTier} />
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} t={t} href={(p) => hrefWith('/users', params, { page: p > 1 ? String(p) : undefined })} />
        </>
      )}
    </div>
  );
}
