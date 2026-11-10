import Link from 'next/link';
import { ADMIN_USER_SORTS } from '@al-ummah/shared-types';
import { listUsers } from '@/lib/api/content';
import type { AdminPage, AdminUserRow } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { FilterForm } from '@/components/content/FilterForm';
import { Chip, EmptyState, MonoId, Notice, PageHeader, Pager, tableWrapClass, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { PAGE_SIZE, hrefWith, pickParams, type SearchParams } from '@/components/content/query';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** Videos users: Al Ummah Now videos profiles (api-videos), keyed by the usr_ id. Not Auth accounts. */
export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = pickParams(await searchParams, { q: 'text', banned: ['yes', 'no'], sort: ADMIN_USER_SORTS, page: 'page' });
  const { t, locale } = await getI18n();
  const page = Number(params.page ?? 1);

  let data: AdminPage<AdminUserRow> | null = null;
  try {
    data = await listUsers({ ...params, page, pageSize: PAGE_SIZE });
  } catch (e) {
    logger.error('[users] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div>
      <PageHeader title={t('users.title')} subtitle={t('users.subtitle')} total={data?.total} t={t} />
      <FilterForm
        action="/users"
        label={t('users.title')}
        testId="users-filters"
        values={params}
        fields={[
          { kind: 'search', name: 'q', label: t('users.searchLabel') },
          { kind: 'select', name: 'banned', label: t('users.status'), options: [{ value: 'yes', label: t('users.banned') }, { value: 'no', label: t('users.notBanned') }] },
          { kind: 'select', name: 'sort', label: t('content.sort'), allLabel: t('users.sortNewest'), options: [{ value: 'oldest', label: t('users.sortOldest') }, { value: 'name', label: t('users.sortName') }] },
        ]}
      />
      {!data && <ErrorAlert testId="users-error">{t('content.loadFailed')}</ErrorAlert>}
      {data && !data.indexComplete && <Notice tone="warn">{t('content.indexBuilding')}</Notice>}
      {data && data.items.length === 0 && <EmptyState>{t('content.empty')}</EmptyState>}
      {data && data.items.length > 0 && (
        <>
          <div className={tableWrapClass}>
            <table className="w-full" data-testid="users-table">
              <caption className="sr-only">{t('users.tableCaption')}</caption>
              <thead className="border-b border-border">
                <tr>
                  <th className={thClass} scope="col">{t('users.colUser')}</th>
                  <th className={`${thClass} ${wideOnly}`} scope="col">{t('users.colEmail')}</th>
                  <th className={thClass} scope="col">{t('users.colStatus')}</th>
                  <th className={`${thClass} ${wideOnly}`} scope="col">{t('users.colCreated')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-surface-hover" data-testid="user-row" data-user-id={u.id}>
                    <td className={tdClass}>
                      <div className="flex items-center gap-3 min-w-0">
                        {u.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- remote avatars from the images CDN
                          <img src={u.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover shrink-0 bg-surface-2" loading="lazy" />
                        ) : (
                          <span aria-hidden="true" className="h-10 w-10 rounded-full bg-surface-2 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <Link href={`/users/${encodeURIComponent(u.id)}`} className={`${linkClass} font-medium break-words`} dir="auto" data-testid="user-link">
                            {u.displayName || u.userName || u.id}
                          </Link>
                          {u.userName && <span className="block text-sm text-fg-muted" dir="ltr">@{u.userName}</span>}
                          <span className="block"><MonoId value={u.id} max={24} /></span>
                          {u.email && <span className="block md:hidden text-xs text-fg-muted" dir="ltr">{u.email}</span>}
                        </div>
                      </div>
                    </td>
                    <td className={`${tdClass} ${wideOnly} text-sm text-fg break-all`} dir="ltr">{u.email ?? t('content.none')}</td>
                    <td className={tdClass}>
                      <div className="flex flex-wrap gap-1">
                        {u.isBanned ? <Chip tone="bad" testId="chip-banned">{t('users.banned')}</Chip> : <span className="text-fg-subtle text-sm">{t('users.active')}</span>}
                        {u.profileDeleted && <Chip tone="neutral">{t('users.profileDeleted')}</Chip>}
                      </div>
                    </td>
                    <td className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}>{u.createdAt ? <time dateTime={u.createdAt}>{formatDate(u.createdAt, locale)}</time> : t('content.none')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} t={t} href={(p) => hrefWith('/users', params, { page: p > 1 ? String(p) : undefined })} />
        </>
      )}
    </div>
  );
}
