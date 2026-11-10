import Link from 'next/link';
import { ADMIN_DELETION_KINDS, TRASH_KINDS, deletionDaysLeft } from '@al-ummah/shared-types';
import { trashHref } from '@/lib/trash';
import { getContentPermissions, listDeletions } from '@/lib/api/content';
import type { AdminContentPermission, AdminDeletion, AdminDeletionKind, AdminDeletionPage } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { Chip, CursorPager, EmptyState, MonoId, PageHeader, tableWrapClass, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { hrefWith, PAGE_SIZE, pickParams, type SearchParams } from '@/components/content/query';
import { logger } from '@/lib/logger';
import { DeletionActions } from './DeletionActions';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<AdminDeletionKind, MessageKey> = {
  channel: 'deleted.kinds.channel',
  video: 'deleted.kinds.video',
  comment: 'deleted.kinds.comment',
  playlist: 'deleted.kinds.playlist',
  post: 'deleted.kinds.post',
  user: 'deleted.kinds.user',
};

/** Where the item lived, for the admin to look at it (comments and posts have no detail page). */
function itemHref(d: AdminDeletion): string | null {
  if (d.kind === 'channel') return `/channels/${encodeURIComponent(d.id)}`;
  if (d.kind === 'video') return `/videos/${encodeURIComponent(d.id)}`;
  if (d.kind === 'user') return `/users/${encodeURIComponent(d.id)}`;
  return null;
}

/**
 * Recently deleted: every delete made in the videos admin is a soft delete,
 * restorable here for 30 days; then the hourly cleanup deletes it permanently.
 * "Delete permanently now" queues it for the next cleanup run instead.
 */
export default async function DeletedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = pickParams(await searchParams, { kind: 'text', cursor: 'text' });
  const kind = (ADMIN_DELETION_KINDS as readonly string[]).includes(params.kind ?? '') ? (params.kind as AdminDeletionKind) : undefined;
  const { t, locale } = await getI18n();

  let data: AdminDeletionPage | null = null;
  let permissions: AdminContentPermission[] = [];
  try {
    [data, permissions] = await Promise.all([listDeletions({ kind, cursor: params.cursor, pageSize: PAGE_SIZE }), getContentPermissions()]);
  } catch (e) {
    logger.error('[deleted] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }
  const canRestore = permissions.includes('content:delete');
  const canPurge = permissions.includes('content:purge');
  const canManageUsers = permissions.includes('users:manage');
  const filters = kind ? { kind } : {};
  const now = Date.now();

  return (
    <div>
      <PageHeader title={t('deleted.title')} subtitle={t('deleted.subtitle')} t={t} />
      <nav aria-label={t('deleted.kindsLabel')} className="flex flex-wrap gap-2 mb-4" data-testid="deleted-kinds">
        {[undefined, ...ADMIN_DELETION_KINDS].map((k) => {
          const active = k === kind;
          return (
            <Link
              key={k ?? 'all'}
              href={hrefWith('/deleted', k ? { kind: k } : {})}
              aria-current={active ? 'page' : undefined}
              className={`px-3 py-1.5 rounded-full border text-sm ${active ? 'border-focus bg-surface-2 text-fg font-medium' : 'border-border text-fg-muted hover:bg-surface-hover'}`}
              data-testid={`deleted-kind-${k ?? 'all'}`}
            >
              {k ? t(KIND_LABEL[k]) : t('deleted.kinds.all')}
            </Link>
          );
        })}
      </nav>
      <p className="text-sm text-fg-muted mb-4" data-testid="deleted-other-areas">
        {t('deleted.otherAreas')}{' '}
        {TRASH_KINDS.map((k, i) => (
          <span key={k}>
            {i > 0 && ', '}
            <Link href={trashHref(k)} className={linkClass}>{t(`trash.kind.${k}` as MessageKey)}</Link>
          </span>
        ))}
      </p>
      {data?.lastRun && (
        <p className="text-xs text-fg-subtle mb-4" data-testid="deleted-last-run">
          {t('deleted.lastRun', { when: formatDate(data.lastRun.at, locale, true), purged: String(data.lastRun.purged), failed: String(data.lastRun.failed) })}
        </p>
      )}
      {!data && <ErrorAlert testId="deleted-error">{t('content.loadFailed')}</ErrorAlert>}
      {data && data.items.length === 0 && <EmptyState>{t('deleted.empty')}</EmptyState>}
      {data && data.items.length > 0 && (
        <div className={tableWrapClass}>
          <table className="w-full" data-testid="deleted-table">
            <caption className="sr-only">{t('deleted.tableCaption')}</caption>
            <thead className="border-b border-border">
              <tr>
                <th className={thClass} scope="col">{t('deleted.colItem')}</th>
                <th className={`${thClass} ${wideOnly}`} scope="col">{t('deleted.colDeletedBy')}</th>
                <th className={`${thClass} ${wideOnly}`} scope="col">{t('deleted.colDeletedAt')}</th>
                <th className={thClass} scope="col">{t('deleted.colStatus')}</th>
                <th className={thClass} scope="col"><span className="sr-only">{t('content.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((d) => {
                const href = itemHref(d);
                const daysLeft = deletionDaysLeft(d, now);
                return (
                  <tr key={`${d.kind}:${d.id}`} className="border-b border-border last:border-0" data-testid="deleted-row" data-kind={d.kind} data-id={d.id} data-status={d.status}>
                    <td className={tdClass}>
                      <Chip tone="neutral">{t(KIND_LABEL[d.kind])}</Chip>
                      <span className="block font-medium text-fg break-words mt-1" dir="auto">
                        {href ? <Link href={href} className={linkClass}>{d.title || d.id}</Link> : d.title || d.id}
                      </span>
                      <span className="block"><MonoId value={d.id} max={32} /></span>
                      {d.reason && <span className="block text-sm text-fg-muted mt-1" dir="auto">{t('deleted.reason', { reason: d.reason })}</span>}
                      <span className="md:hidden block text-xs text-fg-muted mt-1">
                        {t('deleted.byOn', { who: d.deletedBy, when: formatDate(d.deletedAt, locale, true) })}
                      </span>
                    </td>
                    <td className={`${tdClass} ${wideOnly} text-sm`}>
                      <Link href={`/users/${encodeURIComponent(d.deletedBy)}`} className={linkClass}><MonoId value={d.deletedBy} max={24} /></Link>
                    </td>
                    <td className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}>
                      <time dateTime={d.deletedAt}>{formatDate(d.deletedAt, locale, true)}</time>
                    </td>
                    <td className={`${tdClass} text-sm`}>
                      {d.status === 'deleted' && <Chip tone="info" testId="deleted-days-left">{t('deleted.daysLeft', { count: String(daysLeft) })}</Chip>}
                      {d.status === 'queued' && <Chip tone="warn" testId="deleted-queued">{t('deleted.queued')}</Chip>}
                      {d.status === 'purging' && <Chip tone="bad" testId="deleted-purging">{t('deleted.purging')}</Chip>}
                      {d.lastError && d.attempts > 0 && <span className="block text-xs text-danger-fg mt-1">{t('deleted.retrying', { count: String(d.attempts) })}</span>}
                    </td>
                    <td className={tdClass}>
                      <DeletionActions
                        kind={d.kind}
                        id={d.id}
                        status={d.status}
                        canRestore={canRestore && (d.kind !== 'user' || canManageUsers)}
                        canPurge={canPurge}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <CursorPager
          hasCursor={!!params.cursor}
          nextHref={data.nextCursor ? hrefWith('/deleted', filters, { cursor: data.nextCursor }) : null}
          firstHref={hrefWith('/deleted', filters)}
          labels={{ first: t('deleted.firstPage'), next: t('deleted.morePages') }}
          t={t}
        />
      )}
    </div>
  );
}
