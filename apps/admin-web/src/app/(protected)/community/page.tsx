import Link from '@/components/AppLink';
import { deletePost, getContentPermissions, listPosts } from '@/lib/api/content';
import type { AdminContentPermission, AdminPostRow, CursorPage } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { formatCount, translateDynamic } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { FilterForm } from '@/components/content/FilterForm';
import { DeleteRowButton } from '@/components/content/actions';
import { Chip, CursorPager, EmptyState, MetaLine, PageHeader, cardTable, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { PAGE_SIZE, hrefWith, pickParams, type SearchParams } from '@/components/content/query';
import { logger } from '@/lib/logger';
import { getNames } from '@/lib/api/audit';

import { LocalTime } from '@/components/LocalTime';
export const dynamic = 'force-dynamic';

export default async function CommunityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = pickParams(await searchParams, { q: 'text', channelId: 'text', cursor: 'text' });
  const { t, locale } = await getI18n();
  const { cursor, ...filters } = params;

  let data: CursorPage<AdminPostRow> | null = null;
  let permissions: AdminContentPermission[] = [];
  try {
    [data, permissions] = await Promise.all([listPosts({ ...params, pageSize: PAGE_SIZE }), getContentPermissions()]);
  } catch (e) {
    logger.error('[community] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }
  const canDelete = permissions.includes('content:delete');
  // Channels by name, never by id (one lookup for the page)
  const names = data ? await getNames({ users: [], items: data.items.map((p) => ({ kind: 'channel' as const, id: p.channelId })) }) : { users: {}, items: {} };

  return (
    <div>
      <PageHeader deletedKind="post" title={t('community.title')} subtitle={t('community.subtitle')} t={t} />
      <FilterForm
        action="/community"
        label={t('community.title')}
        testId="community-filters"
        values={filters}
        fields={[
          { kind: 'search', name: 'q', label: t('community.searchLabel'), suggest: 'post' },
          { kind: 'pick', name: 'channelId', label: t('community.channelId'), suggest: 'channel' },
        ]}
      />
      {!data && <ErrorAlert testId="community-error">{t('content.loadFailed')}</ErrorAlert>}
      {data && data.items.length === 0 && <EmptyState>{t('content.empty')}</EmptyState>}
      {data && data.items.length > 0 && (
        <div className={cardTable.wrap}>
          <table role="table" className={cardTable.table} data-testid="community-table">
            <caption className="sr-only">{t('community.tableCaption')}</caption>
            <thead role="rowgroup" className={`${cardTable.head} border-b border-border`}>
              <tr role="row">
                <th role="columnheader" className={thClass} scope="col">{t('community.colPost')}</th>
                <th role="columnheader" className={`${thClass} ${wideOnly}`} scope="col">{t('community.colChannel')}</th>
                <th role="columnheader" className={`${thClass} ${wideOnly}`} scope="col">{t('community.colEngagement')}</th>
                <th role="columnheader" className={`${thClass} ${wideOnly}`} scope="col">{t('community.colCreated')}</th>
                {canDelete && <th role="columnheader" className={thClass} scope="col"><span className="sr-only">{t('content.actions')}</span></th>}
              </tr>
            </thead>
            <tbody role="rowgroup" className={cardTable.body}>
              {data.items.map((p) => {
                const channelName = names.items[`channel:${p.channelId}`]?.title || t('content.unnamedChannel');
                const channelHref = `/channels/${encodeURIComponent(p.channelId)}`;
                const engagement = <MetaLine className="block" parts={[formatCount(p.likes, 'like', locale), formatCount(p.comments, 'comment', locale)]} />;
                return (
                  <tr role="row" key={`${p.channelId}:${p.id}`} className={cardTable.row} data-testid="post-row" data-post-id={p.id}>
                    <td role="cell" className={cardTable.cell}>
                      <p className="text-fg text-sm whitespace-pre-wrap break-words max-w-prose line-clamp-4">{p.text ? <bdi>{p.text}</bdi> : <span className="italic text-fg-muted">{t('content.noText')}</span>}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {p.type && <Chip tone="neutral">{translateDynamic(t, 'community.postTypes', p.type)}</Chip>}
                      </div>
                      {/* Phone: the channel, likes, comments and date (their columns are hidden) */}
                      <MetaLine
                        className="block md:hidden text-xs text-fg-muted mt-2"
                        testId="post-meta"
                        parts={[
                          <Link key="c" href={channelHref} className={linkClass}>{channelName}</Link>,
                          formatCount(p.likes, 'like', locale),
                          formatCount(p.comments, 'comment', locale),
                          p.createdAt ? <LocalTime value={p.createdAt} key="d" /> : null,
                        ]}
                      />
                    </td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-sm`}>
                      <Link href={channelHref} className={`${linkClass} [overflow-wrap:anywhere]`} dir="auto" data-testid="post-channel-link">{channelName}</Link>
                    </td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-sm whitespace-nowrap`}>{engagement}</td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}>{p.createdAt ? <LocalTime value={p.createdAt} withTime /> : t('content.none')}</td>
                    {canDelete && (
                      <td role="cell" className={cardTable.actions}>
                        <DeleteRowButton title={t('community.deleteTitle')} body={t('community.deleteBody')} testId="post-delete" onDelete={deletePost.bind(null, p.channelId, p.id)} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <CursorPager
          hasCursor={!!cursor}
          nextHref={data.nextCursor ? hrefWith('/community', filters, { cursor: data.nextCursor }) : null}
          firstHref={hrefWith('/community', filters)}
          labels={{ first: t('playlists.firstPage'), next: t('playlists.morePages') }}
          t={t}
        />
      )}
    </div>
  );
}
