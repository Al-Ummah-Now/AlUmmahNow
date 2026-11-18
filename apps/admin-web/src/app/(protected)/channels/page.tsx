import Link from '@/components/AppLink';
import { ADMIN_CHANNEL_SORTS } from '@al-ummah/shared-types';
import { listChannels } from '@/lib/api/content';
import type { AdminChannelRow, AdminPage } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { formatCount, formatDate, formatNumber } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { FilterForm } from '@/components/content/FilterForm';
import { Chip, EmptyState, MetaLine, Notice, PageHeader, Pager, cardTable, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { PAGE_SIZE, hrefWith, pickParams, type SearchParams } from '@/components/content/query';
import { logger } from '@/lib/logger';
import { getNames } from '@/lib/api/audit';
import { adminUserName } from '@/lib/user-name';

export const dynamic = 'force-dynamic';

const YES_NO = ['yes', 'no'] as const;

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = pickParams(await searchParams, {
    q: 'text',
    ownerId: 'text',
    verified: YES_NO,
    suspended: YES_NO,
    reported: ['yes'],
    createdFrom: 'date',
    createdTo: 'date',
    sort: ADMIN_CHANNEL_SORTS,
    page: 'page',
  });
  const { t, locale } = await getI18n();
  const page = Number(params.page ?? 1);

  let data: AdminPage<AdminChannelRow> | null = null;
  try {
    data = await listChannels({ ...params, page, pageSize: PAGE_SIZE });
  } catch (e) {
    logger.error('[channels] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }

  const yesNo = (yes: string, no: string) => [
    { value: 'yes', label: yes },
    { value: 'no', label: no },
  ];

  // Owners by name (display name, else email, else "Unnamed account"): the same person reads the
  // same on every list, never an id or an @handle
  const names = data ? await getNames({ users: data.items.flatMap((ch) => (ch.ownerId ? [ch.ownerId] : [])), items: [] }) : { users: {}, items: {} };
  const ownerName = (ch: AdminChannelRow) => adminUserName({ displayName: ch.ownerId ? names.users[ch.ownerId]?.name : null, email: (ch.ownerId ? names.users[ch.ownerId]?.email : null) ?? ch.ownerEmail }, t('content.unnamedAccount'));

  return (
    <div>
      <PageHeader deletedKind="channel" title={t('channels.title')} subtitle={t('channels.subtitle')} total={data?.total} t={t} />
      <FilterForm
        action="/channels"
        label={t('channels.title')}
        testId="channels-filters"
        values={params}
        fields={[
          { kind: 'search', name: 'q', label: t('channels.searchLabel'), suggest: 'channel' },
          { kind: 'pick', name: 'ownerId', label: t('channels.ownerFilter'), suggest: 'user' },
          { kind: 'select', name: 'verified', label: t('channels.verified'), options: yesNo(t('channels.verified'), t('channels.unverified')) },
          { kind: 'select', name: 'suspended', label: t('channels.status'), options: yesNo(t('channels.suspended'), t('channels.active')) },
          { kind: 'flag', name: 'reported', label: t('content.reportedOnly'), value: 'yes' },
          { kind: 'date', name: 'createdFrom', label: t('content.from') },
          { kind: 'date', name: 'createdTo', label: t('content.to') },
          {
            kind: 'select',
            name: 'sort',
            label: t('content.sort'),
            allLabel: t('channels.sortNewest'),
            options: [
              { value: 'oldest', label: t('channels.sortOldest') },
              { value: 'name', label: t('channels.sortName') },
              { value: 'views', label: t('channels.sortViews') },
            ],
          },
        ]}
      />
      {!data && <ErrorAlert testId="channels-error">{t('content.loadFailed')}</ErrorAlert>}
      {data && !data.indexComplete && <Notice tone="warn">{t('content.indexBuilding')}</Notice>}
      {data && data.items.length === 0 && <EmptyState>{t('content.empty')}</EmptyState>}
      {data && data.items.length > 0 && (
        <>
          <div className={cardTable.wrap}>
            <table role="table" className={cardTable.table} data-testid="channels-table">
              <caption className="sr-only">{t('channels.tableCaption')}</caption>
              <thead role="rowgroup" className={`${cardTable.head} bg-surface-2`}>
                <tr role="row">
                  <th role="columnheader" scope="col" className={thClass}>{t('channels.colChannel')}</th>
                  <th role="columnheader" scope="col" className={`${thClass} ${wideOnly}`}>{t('channels.colOwner')}</th>
                  <th role="columnheader" scope="col" className={thClass}>{t('channels.colStatus')}</th>
                  <th role="columnheader" scope="col" className={`${thClass} ${wideOnly} text-end`}>{t('channels.colSubscribers')}</th>
                  <th role="columnheader" scope="col" className={`${thClass} ${wideOnly} text-end`}>{t('channels.colViews')}</th>
                  <th role="columnheader" scope="col" className={`${thClass} ${wideOnly}`}>{t('channels.colCreated')}</th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={`${cardTable.body} md:divide-y md:divide-border`}>
                {data.items.map((ch) => (
                  <tr role="row" key={ch.id} className={`${cardTable.row} md:hover:bg-surface-hover`} data-testid="channel-row" data-channel-id={ch.id}>
                    <td role="cell" className={cardTable.cell}>
                      <div className="flex items-start gap-3 min-w-0">
                        {ch.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- remote avatars from the images CDN
                          <img src={ch.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover shrink-0 bg-surface-2" loading="lazy" />
                        ) : (
                          // No picture: the channel's initial, like the site's avatars
                          <span aria-hidden="true" className="h-10 w-10 rounded-full bg-surface-2 shrink-0 grid place-items-center text-fg-muted font-semibold" dir="auto">
                            {Array.from((ch.name || '?').trim())[0]}
                          </span>
                        )}
                        <div className="min-w-0">
                          <Link href={`/channels/${encodeURIComponent(ch.id)}`} className={`${linkClass} font-medium break-words`} dir="auto">
                            {ch.name || t('content.unnamedChannel')}
                          </Link>
                          {ch.handle && (
                            <span className="block text-sm text-fg-muted">
                              <bdi dir="ltr">@{ch.handle}</bdi>
                            </span>
                          )}
                          {/* Phone: the owner, subscribers and views (their columns are hidden) */}
                          <MetaLine
                            className="block md:hidden text-xs text-fg-muted mt-1"
                            testId="channel-meta"
                            parts={[
                              ch.ownerId ? <Link key="o" href={`/users/${encodeURIComponent(ch.ownerId)}`} className={linkClass}>{ownerName(ch)}</Link> : null,
                              formatCount(ch.subscribers, 'subscriber', locale),
                              formatCount(ch.views, 'view', locale),
                            ]}
                          />
                        </div>
                      </div>
                    </td>
                    <td role="cell" className={`${tdClass} ${wideOnly}`}>
                      {ch.ownerId ? (
                        <Link href={`/users/${encodeURIComponent(ch.ownerId)}`} className={`${linkClass} text-sm break-words`} dir="auto" data-testid="channel-owner-link">
                          {ownerName(ch)}
                        </Link>
                      ) : (
                        <span className="text-fg-subtle">{t('content.none')}</span>
                      )}
                    </td>
                    <td role="cell" className={cardTable.cell}>
                      <div className="flex flex-wrap gap-1">
                        {ch.isSuspended && <Chip tone="bad" testId="chip-suspended">{t('channels.suspended')}</Chip>}
                        {ch.isVerified && <Chip tone="good" testId="chip-verified">{t('channels.verified')}</Chip>}
                        {ch.isPrivate && <Chip tone="neutral">{t('channels.private')}</Chip>}
                        {ch.isDeleted && <Chip tone="neutral">{t('channels.deleted')}</Chip>}
                        {!!ch.openReports && (
                          <Chip tone="warn" testId="chip-reports">
                            {t('content.openReports', { count: ch.openReports })}
                          </Chip>
                        )}
                        {!ch.isSuspended && !ch.isVerified && !ch.isPrivate && !ch.isDeleted && !ch.openReports && (
                          <span className="text-fg-subtle text-sm">{t('channels.active')}</span>
                        )}
                      </div>
                    </td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-end tabular-nums`}>{formatNumber(ch.subscribers, locale)}</td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-end tabular-nums`}>{formatNumber(ch.views, locale)}</td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}>
                      {ch.createdAt ? <time dateTime={ch.createdAt}>{formatDate(ch.createdAt, locale)}</time> : t('content.none')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} t={t} href={(p) => hrefWith('/channels', params, { page: p > 1 ? String(p) : undefined })} />
        </>
      )}
    </div>
  );
}
