import Link from '@/components/AppLink';
import { listContactMessages } from '@/lib/api/admin';
import type { ContactListResponse } from '@/lib/api/types';
import { getAdminSession } from '@/lib/auth';
import { canUseContactInbox } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, translateDynamic } from '@/i18n/translate';
import { ContactStatusChip, ErrorAlert, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { trashHref } from '@/lib/trash';
import { ContactFilterBar } from './ContactFilterBar';
import { CONTACT_PAGE_SIZE, contactHref, hasContactFilters, parseContactFilters } from './filters';
import { LiveRefresh } from '@/components/LiveRefresh';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const thClass = 'text-start px-4 sm:px-6 py-3 text-fg-muted font-medium whitespace-nowrap';
const pagerClass =
  'px-4 py-2 bg-surface border border-border text-fg rounded hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

export default async function ContactInboxPage({ searchParams }: PageProps) {
  const filters = parseContactFilters(await searchParams);
  const { t, locale } = await getI18n();
  const session = await getAdminSession();

  if (!canUseContactInbox(session?.user.role)) {
    return <ErrorAlert testId="contact-no-access">{t('contact.noAccess')}</ErrorAlert>;
  }

  let data: ContactListResponse | null = null;
  try {
    data = await listContactMessages({
      status: filters.status,
      topic: filters.topic,
      from: filters.from,
      to: filters.to,
      q: filters.q,
      assignee: filters.assignee,
      limit: CONTACT_PAGE_SIZE,
      offset: (filters.page - 1) * CONTACT_PAGE_SIZE,
    });
  } catch (e) {
    logger.error('[contact] Failed to load messages', { error: e instanceof Error ? e.message : String(e) });
  }
  const totalPages = data ? Math.max(1, Math.ceil(data.total / CONTACT_PAGE_SIZE)) : 0;

  return (
    <div>
      <LiveRefresh topics={['moderation']} queues={['contact']} />
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('contact.title')}</h1>
        <p className="text-fg-muted mt-1">
          {t('contact.subtitle')}
          {data && (
            <span data-testid="contact-total" data-total={data.total}>
              {' · '}
              {t('contact.totalCount', { count: data.total })}
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

      {data && data.messages.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-8 text-center text-fg-muted" data-testid="contact-empty">
          {t('contact.empty')}
        </div>
      )}

      {data && data.messages.length > 0 && (
        <>
          <div className="bg-surface border border-border rounded-lg overflow-x-auto">
            <table className="w-full" data-testid="contact-table">
              <caption className="sr-only">{t('contact.tableCaption')}</caption>
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className={thClass}>{t('contact.colFrom')}</th>
                  <th scope="col" className={thClass}>{t('contact.colTopic')}</th>
                  <th scope="col" className={thClass}>{t('contact.colMessage')}</th>
                  <th scope="col" className={thClass}>{t('contact.colStatus')}</th>
                  <th scope="col" className={thClass}>{t('contact.colReceived')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.messages.map((m) => (
                  <tr
                    key={m.id}
                    className={`hover:bg-surface-hover ${m.status === 'new' ? 'font-semibold' : ''}`}
                    data-testid="contact-row"
                    data-message-id={m.id}
                    data-status={m.status}
                  >
                    <td className="px-4 sm:px-6 py-4 align-top">
                      <Link href={`/contact/${encodeURIComponent(m.id)}`} className={linkClass} aria-label={t('contact.openMessage', { name: m.name })}>
                        <span dir="auto">{m.name}</span>
                      </Link>
                      <span className="block text-xs text-fg-subtle font-normal" dir="ltr">
                        {m.email}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-4 align-top text-fg-muted whitespace-nowrap font-normal">{translateDynamic(t, 'contactTopic', m.topic)}</td>
                    <td className="px-4 sm:px-6 py-4 align-top">
                      <span className="block max-w-md truncate text-fg font-normal" dir="auto">
                        {m.message}
                      </span>
                      {m.assignee_email && (
                        <span className="block text-xs text-fg-subtle font-normal">
                          {t('contact.assignee')}: <span dir="ltr">{m.assignee_id === session?.user.id ? t('contact.you') : m.assignee_email}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 sm:px-6 py-4 align-top">
                      <span className="flex flex-wrap gap-1">
                        <ContactStatusChip status={m.status} label={translateDynamic(t, 'contactStatus', m.status)} />
                        {m.send_failed_at && <ContactStatusChip status="send_failed" label={t('contact.sendFailed')} />}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-4 align-top text-fg-muted text-sm whitespace-nowrap font-normal">
                      <time dateTime={m.created_at}>{formatDate(m.created_at, locale, true)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <nav aria-label={t('contact.paginationLabel')} className="flex justify-center items-center gap-2 mt-6">
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
        </>
      )}
    </div>
  );
}
