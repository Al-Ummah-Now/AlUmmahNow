import Link from '@/components/AppLink';
import { deletePlaylist, getContentPermissions, listPlaylists } from '@/lib/api/content';
import type { AdminContentPermission, AdminPlaylistRow, CursorPage } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { formatDate, formatNumber } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { FilterForm } from '@/components/content/FilterForm';
import { DeleteRowButton } from '@/components/content/actions';
import { Chip, CursorPager, EmptyState, MonoId, PageHeader, tableWrapClass, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { PAGE_SIZE, hrefWith, pickParams, type SearchParams } from '@/components/content/query';
import { logger } from '@/lib/logger';

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
        <div className={tableWrapClass}>
          <table className="w-full" data-testid="playlists-table">
            <caption className="sr-only">{t('playlists.tableCaption')}</caption>
            <thead className="border-b border-border">
              <tr>
                <th className={thClass} scope="col">{t('playlists.colPlaylist')}</th>
                <th className={`${thClass} ${wideOnly}`} scope="col">{t('playlists.colChannel')}</th>
                <th className={`${thClass} ${wideOnly}`} scope="col">{t('playlists.colOwner')}</th>
                <th className={`${thClass} ${wideOnly} text-end`} scope="col">{t('playlists.colVideos')}</th>
                <th className={`${thClass} ${wideOnly}`} scope="col">{t('playlists.colCreated')}</th>
                {canDelete && <th className={thClass} scope="col"><span className="sr-only">{t('content.actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0" data-testid="playlist-row" data-playlist-id={p.id}>
                  <td className={tdClass}>
                    <span className="block font-medium text-fg break-words" dir="auto">{p.title || p.id}</span>
                    <span className="block"><MonoId value={p.id} /></span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Chip tone="neutral">{p.isPublic ? t('videos.public') : t('videos.private')}</Chip>
                      <span className="md:hidden text-xs text-fg-muted">{formatNumber(p.videoCount, locale)} · {p.createdAt ? formatDate(p.createdAt, locale) : ''}</span>
                    </div>
                  </td>
                  <td className={`${tdClass} ${wideOnly} text-sm`}>
                    {p.channelId ? <Link href={`/channels/${encodeURIComponent(p.channelId)}`} className={linkClass}><MonoId value={p.channelId} max={24} /></Link> : <span className="text-fg-subtle">{t('content.none')}</span>}
                  </td>
                  <td className={`${tdClass} ${wideOnly} text-sm`}>
                    {p.ownerId ? <Link href={`/users/${encodeURIComponent(p.ownerId)}`} className={linkClass}><MonoId value={p.ownerId} max={24} /></Link> : <span className="text-fg-subtle">{t('content.none')}</span>}
                  </td>
                  <td className={`${tdClass} ${wideOnly} text-end tabular-nums`}>{formatNumber(p.videoCount, locale)}</td>
                  <td className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}>{p.createdAt ? <time dateTime={p.createdAt}>{formatDate(p.createdAt, locale)}</time> : t('content.none')}</td>
                  {canDelete && (
                    <td className={tdClass}>
                      <DeleteRowButton title={t('playlists.deleteTitle')} body={t('playlists.deleteBody')} testId="playlist-delete" onDelete={deletePlaylist.bind(null, p.id)} />
                    </td>
                  )}
                </tr>
              ))}
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
