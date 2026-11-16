import { UserName } from '@/components/audit/UserName';
import { formatBillingAmount, type AdminBillingSubscriptionDetail } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { cardClass, linkClass } from '@/components/ui';
import { Chip, MonoId, tableWrapClass } from '@/components/content/parts';
import { PAYMENT_TONE, SUBSCRIPTION_TONE } from '@/lib/payments';
import { providerName } from './provider-name';
import { CancelSubscription, RefundPayment } from './SubscriptionActions';

const EVENT_TONE = { queued: 'info', processed: 'good', ignored: 'neutral', failed: 'bad' } as const;

/**
 * One subscription (wiki AUN-SUBS): who and which tier, its details, its
 * payments (with refunds for billing:refund), its webhook events (never their
 * contents) and cancel (billing:manage).
 */
export async function SubscriptionDetail({ detail, back, can }: { detail: AdminBillingSubscriptionDetail; back: React.ReactNode; can: { manage: boolean; refund: boolean } }) {
  const { t, locale } = await getI18n();
  const { subscription: s, payments, events } = detail;
  const name = s.displayName || t('payments.subs.unknownUser');
  const date = (v: string | null) => (v ? formatDate(v, locale, true) : t('payments.detail.none'));
  const money = (amount: number, currency: string) => (
    <span dir="ltr">
      <span className="inline-block" dir="auto">
        {formatBillingAmount(amount, currency, locale)}
      </span>
    </span>
  );
  const rows: [string, React.ReactNode][] = [
    [t('payments.detail.tier'), <span key="tier" dir="auto">{s.tierName}</span>],
    [t('payments.detail.provider'), providerName(t, s.provider)],
    [t('payments.detail.mode'), t(`payments.modes.${s.mode}`)],
    [t('payments.detail.period'), s.period ? t(`payments.periods.${s.period}`) : t('payments.detail.none')],
    [t('payments.detail.amount'), s.amount !== null && s.currency ? money(s.amount, s.currency) : t('payments.detail.none')],
    [t('payments.detail.started'), date(s.createdAt)],
    [t('payments.detail.periodEnd'), date(s.currentPeriodEnd)],
    [t('payments.detail.accessUntil'), date(s.accessUntil)],
    [t('payments.detail.endedAt'), date(s.endedAt)],
    [t('payments.detail.providerRef'), s.providerRef ? <MonoId key="ref" value={s.providerRef} /> : t('payments.detail.none')],
  ];
  if (s.compBy) rows.push([t('payments.detail.compBy'), <UserName key="by" id={s.compBy} showEmail={false} />]);
  if (s.compReason) rows.push([t('payments.detail.compReason'), <span key="why" dir="auto">{s.compReason}</span>]);

  return (
    <div data-testid="payments-detail" data-subscription-id={s.id} data-status={s.status}>
      {back}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        {s.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote avatar from the images CDN
          <img src={s.avatarUrl} alt="" className="h-14 w-14 rounded-full object-cover bg-surface-2" />
        ) : (
          <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-xl font-semibold text-fg-muted">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg-muted">{t('payments.detail.title')}</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-fg break-words">
            <bdi>{name}</bdi>
          </h1>
          <p className="text-sm text-fg-muted flex flex-wrap gap-x-3">
            <Link href={`/users/${encodeURIComponent(s.userId)}`} className={linkClass}>
              {t('payments.detail.userPage')}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={SUBSCRIPTION_TONE[s.status]} large testId="payments-detail-status">
            {t(`payments.status.${s.status}`)}
          </Chip>
          {s.cancelAtPeriodEnd && s.status === 'active' && <span className="text-sm text-fg-muted">{t('payments.subs.cancelsAtEnd')}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className={`${cardClass} lg:col-span-2`} aria-labelledby="payments-detail-summary">
          <h2 id="payments-detail-summary" className="text-lg font-semibold text-fg mb-4">
            {t('payments.detail.summary')}
          </h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-fg-muted">{label}</dt>
                <dd className="text-fg break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        {/* Always in the tree, so its outcome stays on screen after the refresh that removes the form */}
        {can.manage && <CancelSubscription subscription={s} />}
      </div>

      <section className="mt-6" aria-labelledby="payments-detail-payments">
        <h2 id="payments-detail-payments" className="text-lg font-semibold text-fg mb-3">
          {t('payments.detail.payments')}
        </h2>
        {payments.length === 0 ? (
          <p className="text-fg-muted">{t('payments.detail.noPayments')}</p>
        ) : (
          <div className={`${tableWrapClass} relative`}>
            <table className="w-full text-sm" data-testid="payments-detail-payments">
              <thead className="bg-surface-2 text-fg-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.detail.date')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.detail.amount')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.detail.status')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.detail.receipt')}</th>
                  {can.refund && <th scope="col" className="px-3 py-2 text-start font-medium"><span className="sr-only">{t('payments.refund.button')}</span></th>}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-border align-top" data-testid="payments-payment-row" data-status={p.status}>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(p.occurredAt, locale, true)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {money(p.amount, p.currency)}
                      {p.refundedAmount > 0 && <span className="block text-xs text-fg-muted">{t('payments.detail.refunded', { amount: formatBillingAmount(p.refundedAmount, p.currency, locale) })}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Chip tone={PAYMENT_TONE[p.status]}>{t(`payments.paymentStatus.${p.status}`)}</Chip>
                    </td>
                    <td className="px-3 py-2">
                      {p.receiptUrl ? (
                        <a href={p.receiptUrl} target="_blank" rel="noreferrer noopener" className={linkClass} aria-label={t('payments.detail.receiptLabel', { date: formatDate(p.occurredAt, locale) })}>
                          {t('payments.detail.receipt')}
                        </a>
                      ) : (
                        t('payments.detail.none')
                      )}
                    </td>
                    {can.refund && (
                      <td className="px-3 py-2 min-w-[12rem]">
                        <RefundPayment payment={p} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6" aria-labelledby="payments-detail-events">
        <h2 id="payments-detail-events" className="text-lg font-semibold text-fg mb-1">
          {t('payments.detail.events')}
        </h2>
        <p className="text-sm text-fg-muted mb-3">{t('payments.detail.eventsHint')}</p>
        {events.length === 0 ? (
          <p className="text-fg-muted">{t('payments.detail.noEvents')}</p>
        ) : (
          <div className={`${tableWrapClass} relative`}>
            <table className="w-full text-sm" data-testid="payments-detail-events">
              <thead className="bg-surface-2 text-fg-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.detail.type')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.detail.status')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.detail.received')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.detail.processed')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('payments.detail.job')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-t border-border align-top" data-testid="payments-event-row" data-status={ev.status}>
                    <td className="px-3 py-2">
                      <code dir="ltr" className="text-xs">
                        {ev.type}
                      </code>
                      {ev.error && (
                        <span className="block mt-1 text-xs text-danger-fg break-words">
                          {t('payments.detail.error')}: <bdi>{ev.error}</bdi>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Chip tone={EVENT_TONE[ev.status]}>{t(`payments.eventStatus.${ev.status}`)}</Chip>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(ev.receivedAt, locale, true)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{date(ev.processedAt)}</td>
                    <td className="px-3 py-2">
                      {ev.jobId ? (
                        <Link href={ev.status === 'failed' ? '/jobs?status=failed' : '/jobs?status=all'} className={linkClass} aria-label={`${t('payments.detail.viewJob')} ${ev.jobId}`}>
                          {t('payments.detail.viewJob')}
                        </Link>
                      ) : (
                        t('payments.detail.none')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
