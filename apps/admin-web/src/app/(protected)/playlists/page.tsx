import Link from '@/components/AppLink';
import { localizedPlaylistText } from '@al-ummah/shared-types';
import { deletePlaylist, getContentPermissions, listPlaylists } from '@/lib/api/content';
import type { AdminContentPermission, AdminPlaylistRow, CursorPage } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { formatCount, formatDate, formatNumber } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { FilterForm } from '@/components/content/FilterForm';
import { DeleteRowButton } from '@/components/content/actions';
import { Chip, CursorPager, EmptyState, MetaLine, PageHeader, cardTable, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { PAGE_SIZE, hrefWith, pickParams, type SearchParams } from '@/components/content/query';
import { logger } from '@/lib/logger';
import { adminUserName } from '@/lib/user-name';
import { getNames } from '@/lib/api/audit';

export const dynamic = 'force-dynamic';

export default async function PlaylistsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = pickParams(await searchParams, { q: 'text', channelId: 'text', ownerId: 'text', cursor: 'text' });
  const { t, locale } = await getI18n();
  const { cursor, ...filters } = params;

  let data: CursorPage<AdminPlaylistRow> | null = null;
  let permissions: AdminContentPermission[] = [];
  try {
    [data, permissions] = await Promise.all([listPlaylists({ ...params, pageSize: PAGE_SIZE }), getContentPermissions()]);
  } catch (e) {
    logger.error('[playlists] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }
  const canDelete = permissions.includes('content:delete');
  // Channels and owners by name, never by id (one lookup for the page)
  const names = data
    ? await getNames({
        users: data.items.flatMap((p) => (p.ownerId ? [p.ownerId] : [])),
        items: data.items.flatMap((p) => (p.channelId ? [{ kind: 'channel' as const, id: p.channelId }] : [])),
      })
    : { users: {}, items: {} };

  return (
    <div>
      <PageHeader deletedKind="playlist" title={t('playlists.title')} subtitle={t('playlists.subtitle')} t={t} />
      <FilterForm
        action="/playlists"
        label={t('playlists.title')}
        testId="playlists-filters"
        values={filters}
        fields={[
          { kind: 'search', name: 'q', label: t('playlists.searchLabel'), suggest: 'playlist' },
          { kind: 'pick', name: 'channelId', label: t('playlists.channelId'), suggest: 'channel' },
          { kind: 'pick', name: 'ownerId', label: t('playlists.ownerId'), suggest: 'user' },
        ]}
      />
      {!data && <ErrorAlert testId="playlists-error">{t('content.loadFailed')}</ErrorAlert>}
      {data && data.items.length === 0 && <EmptyState>{t('content.empty')}</EmptyState>}
      {data && data.items.length > 0 && (
        <div className={cardTable.wrap}>
          <table role="table" className={cardTable.table} data-testid="playlists-table">
            <caption className="sr-only">{t('playlists.tableCaption')}</caption>
            <thead role="rowgroup" className={`${cardTable.head} border-b border-border`}>
              <tr role="row">
                <th role="columnheader" className={thClass} scope="col">{t('playlists.colPlaylist')}</th>
                <th role="columnheader" className={`${thClass} ${wideOnly}`} scope="col">{t('playlists.colChannel')}</th>
                <th role="columnheader" className={`${thClass} ${wideOnly}`} scope="col">{t('playlists.colOwner')}</th>
                <th role="columnheader" className={`${thClass} ${wideOnly} text-end`} scope="col">{t('playlists.colVideos')}</th>
                <th role="columnheader" className={`${thClass} ${wideOnly}`} scope="col">{t('playlists.colCreated')}</th>
                {canDelete && <th role="columnheader" className={thClass} scope="col"><span className="sr-only">{t('content.actions')}</span></th>}
              </tr>
            </thead>
            <tbody role="rowgroup" className={cardTable.body}>
              {data.items.map((p) => {
                const channelName = p.channelId ? names.items[`channel:${p.channelId}`]?.title || t('content.unnamedChannel') : null;
                // Display name, else email, else "Unnamed account" (never the id or an @handle)
                const ownerName = p.ownerId ? adminUserName({ displayName: names.users[p.ownerId]?.name, email: names.users[p.ownerId]?.email }, t('content.unnamedAccount')) : null;
                const title = localizedPlaylistText(p.title, p.titleLocalized, locale) || Object.values(p.titleLocalized ?? {}).find((x) => x?.trim());
                return (
                  <tr role="row" key={p.id} className={cardTable.row} data-testid="playlist-row" data-playlist-id={p.id}>
                    <td role="cell" className={cardTable.cell}>
                      <span className="block font-medium text-fg break-words">{title ? <bdi>{title}</bdi> : <span className="italic text-fg-muted">{t('content.untitled')}</span>}</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Chip tone="neutral">{p.isPublic ? t('videos.public') : p.isUnlisted ? t('playlists.unlisted') : t('videos.private')}</Chip>
                        {!p.channelId && <Chip tone="neutral">{t('playlists.personal')}</Chip>}
                      </div>
                      {/* Phone: the channel, owner, size and date (their columns are hidden) */}
                      <MetaLine
                        className="block md:hidden text-xs text-fg-muted mt-2"
                        testId="playlist-meta"
                        parts={[
                          channelName && p.channelId ? <Link key="c" href={`/channels/${encodeURIComponent(p.channelId)}`} className={linkClass}>{channelName}</Link> : null,
                          ownerName && p.ownerId ? <Link key="o" href={`/users/${encodeURIComponent(p.ownerId)}`} className={linkClass}>{ownerName}</Link> : null,
                          formatCount(p.videoCount, 'video', locale),
                          p.createdAt ? <time key="d" dateTime={p.createdAt}>{formatDate(p.createdAt, locale)}</time> : null,
                        ]}
                      />
                    </td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-sm md:min-w-[11rem]`}>
                      {channelName && p.channelId ? <Link href={`/channels/${encodeURIComponent(p.channelId)}`} className={`${linkClass} [overflow-wrap:anywhere]`} dir="auto" data-testid="playlist-channel-link">{channelName}</Link> : <span className="text-fg-subtle">{t('content.none')}</span>}
                    </td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-sm md:min-w-[11rem]`}>
                      {ownerName && p.ownerId ? <Link href={`/users/${encodeURIComponent(p.ownerId)}`} className={`${linkClass} [overflow-wrap:anywhere]`} dir="auto" data-testid="playlist-owner-link">{ownerName}</Link> : <span className="text-fg-subtle">{t('content.none')}</span>}
                    </td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-end tabular-nums`}>{formatNumber(p.videoCount, locale)}</td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}>{p.createdAt ? <time dateTime={p.createdAt}>{formatDate(p.createdAt, locale)}</time> : t('content.none')}</td>
                    {canDelete && (
                      <td role="cell" className={cardTable.actions}>
                        <DeleteRowButton title={t('playlists.deleteTitle')} body={t('playlists.deleteBody')} testId="playlist-delete" onDelete={deletePlaylist.bind(null, p.id)} />
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
          nextHref={data.nextCursor ? hrefWith('/playlists', filters, { cursor: data.nextCursor }) : null}
          firstHref={hrefWith('/playlists', filters)}
          labels={{ first: t('playlists.firstPage'), next: t('playlists.morePages') }}
          t={t}
        />
      )}
    </div>
  );
}
