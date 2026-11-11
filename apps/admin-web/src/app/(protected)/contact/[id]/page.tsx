import { notFound } from 'next/navigation';
import Link from '@/components/AppLink';
import { getContactMessage, updateContactMessage } from '@/lib/api/admin';
import { AdminApiError } from '@/lib/api/errors';
import type { ContactMessage, ContactNote } from '@/lib/api/types';
import { getAdminSession } from '@/lib/auth';
import { canUseContactInbox } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, translateDynamic } from '@/i18n/translate';
import { ContactStatusChip, ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { ContactActions } from './ContactActions';
import { DeliveryRetry, RefreshWhileQueued } from './DeliveryRetry';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const dt = 'text-fg-muted text-sm';

export default async function ContactMessagePage({ params }: PageProps) {
  const { id } = await params;
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canUseContactInbox(session?.user.role)) {
    return <ErrorAlert testId="contact-no-access">{t('contact.noAccess')}</ErrorAlert>;
  }

  let data: { message: ContactMessage; notes: ContactNote[] } | null = null;
  try {
    data = await getContactMessage(id);
    // Opening a new message reads it: it leaves the "new" count
    if (data.message.status === 'new') {
      const opened = await updateContactMessage(id, { status: 'open' });
      if (opened.ok) data = { ...data, message: opened.data.message };
    }
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    logger.error('[contact] Failed to load message', { id, error: e instanceof Error ? e.message : String(e) });
  }

  const back = (
    <div className="mb-6">
      <Link href="/contact" className={linkClass}>
        <span aria-hidden="true" className="inline-block rtl:rotate-180">&larr;</span> {t('contact.backToInbox')}
      </Link>
    </div>
  );
  if (!data) {
    return (
      <div>
        {back}
        <ErrorAlert testId="contact-error">{t('contact.loadFailed')}</ErrorAlert>
      </div>
    );
  }

  const { message: m, notes } = data;
  const delivery = (status: string | null) => (status ? translateDynamic(t, 'delivery', status) : t('delivery.pending'));
  const deliveryClass = (status: string | null) => (status === 'failed' ? 'text-danger-fg font-medium' : '');
  // Which emails are still queued: the page re-reads itself while any are
  const queued = [
    m.notify_status === 'queued' ? 'notify' : '',
    m.ack_status === 'queued' ? 'ack' : '',
    ...notes.filter((n) => n.email_status === 'queued').map((n) => n.id),
  ]
    .filter(Boolean)
    .join(',');

  return (
    <div>
      {back}
      <RefreshWhileQueued signature={queued} />
      {m.send_failed_at && (
        <ErrorAlert testId="contact-send-failed">
          <p className="font-medium">{t('contact.sendFailedBanner')}</p>
          {m.delivery_error && <p className="text-sm mt-1 break-words">{t('contact.lastError', { error: m.delivery_error })}</p>}
        </ErrorAlert>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <article className={cardClass} data-testid="contact-message" data-message-id={m.id} data-status={m.status}>
            <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-fg break-words" dir="auto">
                  {m.name}
                </h1>
                <p className="text-fg-muted text-sm">
                  <a href={`mailto:${m.email}`} className={linkClass} dir="ltr" data-testid="contact-sender-email">
                    {m.email}
                  </a>
                  {' · '}
                  {translateDynamic(t, 'contactTopic', m.topic)}
                </p>
              </div>
              <span className="flex flex-wrap gap-2">
                <ContactStatusChip status={m.status} label={translateDynamic(t, 'contactStatus', m.status)} large />
                {m.send_failed_at && <ContactStatusChip status="send_failed" label={t('contact.sendFailed')} large />}
              </span>
            </div>
            <p className="text-fg whitespace-pre-wrap break-words leading-7" dir="auto" data-testid="contact-message-body">
              {m.message}
            </p>
          </article>

          <section className={cardClass} aria-labelledby="contact-thread">
            <h2 id="contact-thread" className="text-lg font-semibold text-fg mb-4">
              {t('contact.thread')}
            </h2>
            {notes.length === 0 ? (
              <p className="text-fg-muted" data-testid="contact-thread-empty">
                {t('contact.threadEmpty')}
              </p>
            ) : (
              <ol className="space-y-4" data-testid="contact-thread">
                {notes.map((n) => (
                  <li
                    key={n.id}
                    data-testid="contact-note"
                    data-kind={n.kind}
                    data-email-status={n.email_status ?? ''}
                    className={`rounded border p-4 ${n.kind === 'reply' ? 'border-accent bg-surface-2' : 'border-border border-dashed'}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2 text-sm">
                      <span className="font-medium text-fg">
                        {n.kind === 'reply' ? t('contact.reply') : t('contact.note')}
                        {n.kind === 'reply' && n.email_to && (
                          <span className="text-fg-muted font-normal">
                            {' '}
                            {t('contact.replyTo', { email: n.email_to })}
                          </span>
                        )}
                      </span>
                      <span className="text-fg-subtle">
                        <span dir="ltr">{n.author_email ?? n.author_id}</span> · <time dateTime={n.created_at}>{formatDate(n.created_at, locale, true)}</time>
                      </span>
                    </div>
                    <p className="text-fg whitespace-pre-wrap break-words" dir="auto">
                      {n.body}
                    </p>
                    {n.kind === 'reply' && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className={n.email_status === 'failed' ? 'text-danger-fg font-medium' : 'text-fg-muted'} data-testid="contact-reply-delivery">
                          {t('contact.delivery')}: {delivery(n.email_status)}
                        </span>
                        {n.email_status === 'failed' && <DeliveryRetry id={m.id} kind="reply" noteId={n.id} />}
                        {n.email_status === 'failed' && n.email_error && <span className="text-fg-subtle break-all">{t('contact.lastError', { error: n.email_error })}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <ContactActions
            id={m.id}
            status={m.status}
            locale={m.locale}
            assignedToMe={!!session && m.assignee_id === session.user.id}
            hasAssignee={!!m.assignee_id}
          />

          <section className={cardClass} aria-labelledby="contact-details">
            <h2 id="contact-details" className="text-lg font-semibold text-fg mb-4">
              {t('contact.details')}
            </h2>
            <dl className="space-y-3">
              <div>
                <dt className={dt}>{t('contact.sender')}</dt>
                <dd className="text-fg" data-testid="contact-sender">
                  {m.user_id ? (
                    <>
                      {t('contact.signedIn')}{' '}
                      <Link href={`/users/${encodeURIComponent(m.user_id)}`} className={linkClass} data-testid="contact-user-link">
                        {t('contact.viewUser')}
                      </Link>
                    </>
                  ) : (
                    t('contact.signedOut')
                  )}
                </dd>
              </div>
              <div>
                <dt className={dt}>{t('contact.assignee')}</dt>
                <dd className="text-fg" data-testid="contact-assignee">
                  {m.assignee_id ? (
                    <span dir="ltr">{m.assignee_id === session?.user.id ? t('contact.you') : (m.assignee_email ?? m.assignee_id)}</span>
                  ) : (
                    t('contact.unassigned')
                  )}
                </dd>
              </div>
              <div>
                <dt className={dt}>{t('contact.language')}</dt>
                <dd className="text-fg">{translateDynamic(t, 'contactLocale', m.locale)}</dd>
              </div>
              {m.page_url && (
                <div>
                  <dt className={dt}>{t('contact.page')}</dt>
                  <dd className="text-fg text-sm break-all" dir="ltr">
                    <a href={m.page_url} className={linkClass} rel="noreferrer noopener" target="_blank" data-testid="contact-page-url">
                      {m.page_url}
                    </a>
                  </dd>
                </div>
              )}
              <div>
                <dt className={dt}>{t('contact.received')}</dt>
                <dd className="text-fg">
                  <time dateTime={m.created_at}>{formatDate(m.created_at, locale, true)}</time>
                </dd>
              </div>
              <div>
                <dt className={dt}>{t('contact.delivery')}</dt>
                <dd className="text-fg text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    {t('contact.notifyStatus')}:{' '}
                    <span data-testid="contact-notify-status" data-status={m.notify_status ?? ''} className={deliveryClass(m.notify_status)}>
                      {delivery(m.notify_status)}
                    </span>
                    {m.notify_status === 'failed' && <DeliveryRetry id={m.id} kind="notify" />}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 mt-1">
                    {t('contact.ackStatus')}:{' '}
                    <span data-testid="contact-ack-status" data-status={m.ack_status ?? ''} className={deliveryClass(m.ack_status)}>
                      {delivery(m.ack_status)}
                    </span>
                    {m.ack_status === 'failed' && <DeliveryRetry id={m.id} kind="ack" />}
                  </span>
                </dd>
              </div>
              {m.user_agent && (
                <div>
                  <dt className={dt}>{t('contact.userAgent')}</dt>
                  <dd className="text-fg-muted text-xs break-all" dir="ltr">
                    {m.user_agent}
                  </dd>
                </div>
              )}
              <div>
                <dt className={dt}>{t('contact.messageId')}</dt>
                <dd className="text-fg-muted text-xs font-mono break-all" dir="ltr">
                  {m.id}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
