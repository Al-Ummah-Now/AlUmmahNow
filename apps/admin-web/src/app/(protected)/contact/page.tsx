import Link from '@/components/AppLink';
import { getContactCounts, listContactMessages } from '@/lib/api/admin';
import type { ContactCounts, ContactListResponse } from '@/lib/api/types';
import { getAdminSession } from '@/lib/auth';
import { canUseContactInbox } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatCount } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { trashHref } from '@/lib/trash';
import { ContactFilterBar } from './ContactFilterBar';
import { ContactInbox } from './ContactInbox';
import { LiveRefresh } from '@/components/LiveRefresh';
import { CONTACT_PAGE_SIZE, contactHref, hasContactFilters, parseContactFilters, type ContactViewId } from './filters';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const pagerClass =
  'px-4 py-2 bg-surface border border-border text-fg rounded hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

/** The views' counts, from the status counts (not narrowed by search or other filters). */
function viewCounts(c: ContactCounts | null): Partial<Record<ContactViewId, number | null>> {
  if (!c) return { all: null, unread: null, open: null, in_progress: null, spam: null, send_failed: null };
  return {
    all: c.open + c.in_progress + c.replied + c.closed + c.spam,
    unread: c.unread,
    open: c.open,
    in_progress: c.in_progress,
    spam: c.spam,
    send_failed: c.send_failed,
  };
}

export default async function ContactInboxPage({ searchParams }: PageProps) {
  const filters = parseContactFilters(await searchParams);
  const { t, locale } = await getI18n();
  const session = await getAdminSession();

  if (!canUseContactInbox(session?.user.role)) {
    return <ErrorAlert testId="contact-no-access">{t('contact.noAccess')}</ErrorAlert>;
  }

  const [list, counts] = await Promise.all([
    listContactMessages({
      status: filters.status,
      topic: filters.topic,
      from: filters.from,
      to: filters.to,
      q: filters.q,
      assignee: filters.assignee,
      read: filters.read,
      limit: CONTACT_PAGE_SIZE,
      offset: (filters.page - 1) * CONTACT_PAGE_SIZE,
    }).catch((e: unknown) => {
      logger.error('[contact] Failed to load messages', { error: e instanceof Error ? e.message : String(e) });
      return null as ContactListResponse | null;
    }),
    getContactCounts().catch((e: unknown) => {
      logger.warn('[contact] Counts unavailable', { error: e instanceof Error ? e.message : String(e) });
      return null;
    }),
  ]);
  const data = list;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / CONTACT_PAGE_SIZE)) : 0;

  return (
    <div className="min-w-0">
      {/* A message arriving or changed anywhere refreshes the list, its counts and the nav badge */}
      <LiveRefresh topics={['moderation']} queues={['contact']} />
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('contact.title')}</h1>
        <p className="text-fg-muted mt-1">
          {t('contact.subtitle')}
          {data && (
            <span data-testid="contact-total" data-total={data.total}>
              {' · '}
              {formatCount(data.total, 'message', locale)}
            </span>
          )}
        </p>
        <Link href={trashHref('contact-message')} className={`${linkClass} text-sm`} data-testid="contact-recently-deleted">
          {t('trash.link')}
        </Link>
      </div>

      <div className="mb-6">
        <ContactFilterBar filters={filters} active={hasContactFilters(filters)} />
      </div>

      {!data && <ErrorAlert testId="contact-error">{t('contact.loadFailed')}</ErrorAlert>}

      {data && (
        <ContactInbox
          messages={data.messages}
          filters={filters}
          viewerId={session?.user.id ?? null}
          canManage
          counts={viewCounts(counts)}
        />
      )}

      {data && data.messages.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-8 text-center text-fg-muted mt-4" data-testid="contact-empty">
          {t('contact.empty')}
        </div>
      )}

      {data && totalPages > 1 && (
        <nav aria-label={t('contact.paginationLabel')} className="flex flex-wrap justify-center items-center gap-2 mt-6">
          {filters.page > 1 && (
            <Link href={contactHref({ ...filters, page: filters.page - 1 })} className={pagerClass} rel="prev">
              {t('contact.previous')}
            </Link>
          )}
          <span className="px-4 py-2 text-fg-muted" aria-current="page">
            {t('contact.pageOf', { page: filters.page, total: totalPages })}
          </span>
          {filters.page < totalPages && (
            <Link href={contactHref({ ...filters, page: filters.page + 1 })} className={pagerClass} rel="next">
              {t('contact.next')}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
