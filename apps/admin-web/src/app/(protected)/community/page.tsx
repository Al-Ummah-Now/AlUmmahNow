import Link from 'next/link';
import { deletePost, getContentPermissions, listPosts } from '@/lib/api/content';
import type { AdminContentPermission, AdminPostRow, CursorPage } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { formatDate, formatNumber } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { FilterForm } from '@/components/content/FilterForm';
import { DeleteRowButton } from '@/components/content/actions';
import { Chip, CursorPager, EmptyState, MonoId, PageHeader, tableWrapClass, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { PAGE_SIZE, hrefWith, pickParams, type SearchParams } from '@/components/content/query';
import { logger } from '@/lib/logger';

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
        <div className={tableWrapClass}>
          <table className="w-full" data-testid="community-table">
            <caption className="sr-only">{t('community.tableCaption')}</caption>
            <thead className="border-b border-border">
              <tr>
                <th className={thClass} scope="col">{t('community.colPost')}</th>
                <th className={`${thClass} ${wideOnly}`} scope="col">{t('community.colChannel')}</th>
                <th className={`${thClass} ${wideOnly} text-end`} scope="col">{t('community.colEngagement')}</th>
                <th className={`${thClass} ${wideOnly}`} scope="col">{t('community.colCreated')}</th>
                {canDelete && <th className={thClass} scope="col"><span className="sr-only">{t('content.actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={`${p.channelId}:${p.id}`} className="border-b border-border last:border-0" data-testid="post-row" data-post-id={p.id}>
                  <td className={tdClass}>
                    <p className="text-fg text-sm whitespace-pre-wrap break-words max-w-prose line-clamp-4" dir="auto">{p.text || p.id}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {p.type && <Chip tone="neutral">{p.type}</Chip>}
                      <MonoId value={p.id} />
                    </div>
                    <span className="block md:hidden text-xs text-fg-muted mt-1">
                      {formatNumber(p.likes, locale)} · {formatNumber(p.comments, locale)} · {p.createdAt ? formatDate(p.createdAt, locale) : ''}
                    </span>
                  </td>
                  <td className={`${tdClass} ${wideOnly} text-sm`}>
                    <Link href={`/channels/${encodeURIComponent(p.channelId)}`} className={linkClass}><MonoId value={p.channelId} max={24} /></Link>
                  </td>
                  <td className={`${tdClass} ${wideOnly} text-end tabular-nums text-sm`}>{formatNumber(p.likes, locale)} · {formatNumber(p.comments, locale)}</td>
                  <td className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}>{p.createdAt ? <time dateTime={p.createdAt}>{formatDate(p.createdAt, locale, true)}</time> : t('content.none')}</td>
                  {canDelete && (
                    <td className={tdClass}>
                      <DeleteRowButton title={t('community.deleteTitle')} body={t('community.deleteBody')} testId="post-delete" onDelete={deletePost.bind(null, p.channelId, p.id)} />
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
          nextHref={data.nextCursor ? hrefWith('/community', filters, { cursor: data.nextCursor }) : null}
          firstHref={hrefWith('/community', filters)}
          labels={{ first: t('playlists.firstPage'), next: t('playlists.morePages') }}
          t={t}
        />
      )}
    </div>
  );
}
