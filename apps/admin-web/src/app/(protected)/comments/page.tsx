import Link from '@/components/AppLink';
import { deleteComment, getContentPermissions, listComments } from '@/lib/api/content';
import type { AdminCommentRow, AdminContentPermission, AdminPage } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { FilterForm } from '@/components/content/FilterForm';
import { DeleteRowButton } from '@/components/content/actions';
import { Chip, EmptyState, MetaLine, PageHeader, cardTable, Pager, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { PAGE_SIZE, hrefWith, pickParams, type SearchParams } from '@/components/content/query';
import { logger } from '@/lib/logger';
import { adminUserName } from '@/lib/user-name';
import { getNames } from '@/lib/api/audit';

export const dynamic = 'force-dynamic';

export default async function CommentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = pickParams(await searchParams, { q: 'text', videoId: 'text', userId: 'text', page: 'page' });
  const { t, locale } = await getI18n();
  const page = Number(params.page ?? 1);

  let data: AdminPage<AdminCommentRow> | null = null;
  let permissions: AdminContentPermission[] = [];
  try {
    [data, permissions] = await Promise.all([listComments({ ...params, page, pageSize: PAGE_SIZE }), getContentPermissions()]);
  } catch (e) {
    logger.error('[comments] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }
  const canDelete = permissions.includes('content:delete');
  // Commenters by name, never by id (one lookup for the page)
  const names = data ? await getNames({ users: data.items.map((c) => c.userId), items: [] }) : { users: {}, items: {} };
  // Display name, else email, else "Unnamed account" (never the id or an @handle)
  const userName = (id: string) => adminUserName({ displayName: names.users[id]?.name, email: names.users[id]?.email }, t('content.unnamedAccount'));

  return (
    <div>
      <PageHeader deletedKind="comment" title={t('comments.title')} subtitle={t('comments.subtitle')} total={data?.total} t={t} />
      <FilterForm
        action="/comments"
        label={t('comments.title')}
        testId="comments-filters"
        values={params}
        fields={[
          { kind: 'search', name: 'q', label: t('comments.searchLabel'), suggest: 'comment' },
          { kind: 'pick', name: 'videoId', label: t('comments.videoId'), suggest: 'video' },
          { kind: 'pick', name: 'userId', label: t('comments.userId'), suggest: 'user' },
        ]}
      />
      {!data && <ErrorAlert testId="comments-error">{t('content.loadFailed')}</ErrorAlert>}
      {data && data.items.length === 0 && <EmptyState>{t('content.empty')}</EmptyState>}
      {data && data.items.length > 0 && (
        <>
          <div className={cardTable.wrap}>
            <table role="table" className={cardTable.table} data-testid="comments-table">
              <caption className="sr-only">{t('comments.tableCaption')}</caption>
              <thead role="rowgroup" className={`${cardTable.head} border-b border-border`}>
                <tr role="row">
                  <th role="columnheader" className={thClass} scope="col">{t('comments.colComment')}</th>
                  <th role="columnheader" className={`${thClass} ${wideOnly}`} scope="col">{t('comments.colVideo')}</th>
                  <th role="columnheader" className={`${thClass} ${wideOnly}`} scope="col">{t('comments.colAuthor')}</th>
                  <th role="columnheader" className={`${thClass} ${wideOnly}`} scope="col">{t('comments.colCreated')}</th>
                  {canDelete && <th role="columnheader" className={thClass} scope="col"><span className="sr-only">{t('content.actions')}</span></th>}
                </tr>
              </thead>
              <tbody role="rowgroup" className={cardTable.body}>
                {data.items.map((c) => (
                  <tr role="row" key={`${c.videoId}:${c.id}`} className={cardTable.row} data-testid="comment-row" data-comment-id={c.id}>
                    <td role="cell" className={cardTable.cell}>
                      <p className="text-fg text-sm whitespace-pre-wrap break-words max-w-prose" dir="auto">{c.text}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.parentId && <Chip tone="neutral">{t('comments.reply')}</Chip>}
                        {c.isHidden && <Chip tone="bad">{t('comments.hidden')}</Chip>}
                      </div>
                      {/* Phone: the video, the author and the date (their columns are hidden) */}
                      <MetaLine
                        className="block md:hidden text-xs text-fg-muted mt-2"
                        testId="comment-meta"
                        parts={[
                          c.videoTitle || t('videos.untitled'),
                          <Link key="u" href={`/users/${encodeURIComponent(c.userId)}`} className={linkClass}>{userName(c.userId)}</Link>,
                          <time key="d" dateTime={c.createdAt}>{formatDate(c.createdAt, locale)}</time>,
                        ]}
                      />
                    </td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-sm`}>
                      <Link href={`/videos/${encodeURIComponent(c.videoId)}`} className={`${linkClass} break-words`} dir="auto">{c.videoTitle || t('videos.untitled')}</Link>
                    </td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-sm`}>
                      <Link href={`/users/${encodeURIComponent(c.userId)}`} className={`${linkClass} break-words`} dir="auto" data-testid="comment-user-link">{userName(c.userId)}</Link>
                    </td>
                    <td role="cell" className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}><time dateTime={c.createdAt}>{formatDate(c.createdAt, locale, true)}</time></td>
                    {canDelete && (
                      <td role="cell" className={cardTable.actions}>
                        <DeleteRowButton title={t('comments.deleteTitle')} body={t('comments.deleteBody')} testId="comment-delete" onDelete={deleteComment.bind(null, c.videoId, c.id)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} t={t} href={(p) => hrefWith('/comments', params, { page: p > 1 ? String(p) : undefined })} />
        </>
      )}
    </div>
  );
}
