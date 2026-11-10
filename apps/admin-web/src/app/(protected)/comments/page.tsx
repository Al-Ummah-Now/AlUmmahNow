import Link from 'next/link';
import { deleteComment, getContentPermissions, listComments } from '@/lib/api/content';
import type { AdminCommentRow, AdminContentPermission, AdminPage } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { FilterForm } from '@/components/content/FilterForm';
import { DeleteRowButton } from '@/components/content/actions';
import { Chip, EmptyState, MonoId, PageHeader, CursorPager, tableWrapClass, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { PAGE_SIZE, hrefWith, pickParams, type SearchParams, withoutPaging } from '@/components/content/query';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export default async function CommentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = pickParams(await searchParams, { q: 'text', videoId: 'text', userId: 'text', page: 'page', cursor: 'cursor' });
  const { t, locale } = await getI18n();
  const page = Number(params.page ?? 1);
  const filters = withoutPaging(params);

  let data: AdminPage<AdminCommentRow> | null = null;
  let permissions: AdminContentPermission[] = [];
  try {
    [data, permissions] = await Promise.all([listComments({ ...params, page, pageSize: PAGE_SIZE }), getContentPermissions()]);
  } catch (e) {
    logger.error('[comments] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }
  const canDelete = permissions.includes('content:delete');

  return (
    <div>
      <PageHeader title={t('comments.title')} subtitle={t('comments.subtitle')} total={data?.total} totalCapped={data?.totalCapped} t={t} />
      <FilterForm
        action="/comments"
        label={t('comments.title')}
        testId="comments-filters"
        values={params}
        fields={[
          { kind: 'search', name: 'q', label: t('comments.searchLabel') },
          { kind: 'text', name: 'videoId', label: t('comments.videoId') },
          { kind: 'text', name: 'userId', label: t('comments.userId') },
        ]}
      />
      {!data && <ErrorAlert testId="comments-error">{t('content.loadFailed')}</ErrorAlert>}
      {data && data.items.length === 0 && <EmptyState>{t('content.empty')}</EmptyState>}
      {data && data.items.length > 0 && (
        <>
          <div className={tableWrapClass}>
            <table className="w-full" data-testid="comments-table">
              <caption className="sr-only">{t('comments.tableCaption')}</caption>
              <thead className="border-b border-border">
                <tr>
                  <th className={thClass} scope="col">{t('comments.colComment')}</th>
                  <th className={`${thClass} ${wideOnly}`} scope="col">{t('comments.colVideo')}</th>
                  <th className={`${thClass} ${wideOnly}`} scope="col">{t('comments.colAuthor')}</th>
                  <th className={`${thClass} ${wideOnly}`} scope="col">{t('comments.colCreated')}</th>
                  {canDelete && <th className={thClass} scope="col"><span className="sr-only">{t('content.actions')}</span></th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={`${c.videoId}:${c.id}`} className="border-b border-border last:border-0" data-testid="comment-row" data-comment-id={c.id}>
                    <td className={tdClass}>
                      <p className="text-fg text-sm whitespace-pre-wrap break-words max-w-prose" dir="auto">{c.text}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.parentId && <Chip tone="neutral">{t('comments.reply')}</Chip>}
                        {c.isHidden && <Chip tone="bad">{t('comments.hidden')}</Chip>}
                      </div>
                      <span className="block md:hidden text-xs text-fg-muted mt-1" dir="auto">
                        {c.videoTitle} · {formatDate(c.createdAt, locale)}
                      </span>
                    </td>
                    <td className={`${tdClass} ${wideOnly} text-sm`}>
                      <Link href={`/videos/${encodeURIComponent(c.videoId)}`} className={`${linkClass} break-words`} dir="auto">{c.videoTitle || c.videoId}</Link>
                    </td>
                    <td className={`${tdClass} ${wideOnly} text-sm`}>
                      <Link href={`/users/${encodeURIComponent(c.userId)}`} className={linkClass}><MonoId value={c.userId} max={24} /></Link>
                    </td>
                    <td className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}><time dateTime={c.createdAt}>{formatDate(c.createdAt, locale, true)}</time></td>
                    {canDelete && (
                      <td className={tdClass}>
                        <DeleteRowButton title={t('comments.deleteTitle')} body={t('comments.deleteBody')} testId="comment-delete" onDelete={deleteComment.bind(null, c.videoId, c.id)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CursorPager
            hasCursor={!!params.cursor || page > 1}
            nextHref={data.cursor ? hrefWith('/comments', filters, { cursor: data.cursor }) : null}
            firstHref={hrefWith('/comments', filters)}
            labels={{ first: t('content.firstPage'), next: t('content.nextPage') }}
            t={t}
          />
        </>
      )}
    </div>
  );
}
