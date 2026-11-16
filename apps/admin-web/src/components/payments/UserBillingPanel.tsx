import { formatBillingAmount, type BillingPayment, type BillingSubscription } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { Chip } from '@/components/content/parts';
import { getUserBilling } from '@/lib/api/billing';
import { listCreatorTierDefinitions } from '@/lib/api/creators';
import { PAYMENT_TONE, SUBSCRIPTION_TONE } from '@/lib/payments';
import { logger } from '@/lib/logger';
import { providerName } from './provider-name';
import { CompForm } from './CompForm';
import { tierLabel } from '@/lib/creator-tiers';

/**
 * The user page's payments (wiki AUN-SUBS, GET /api/billing/users/:id): their
 * subscriptions (each opens its page) and payments, and the comp form with
 * their id filled in (billing:manage). Shown with billing:read.
 */
export async function UserBillingPanel({ userId, canManage }: { userId: string; canManage: boolean }) {
  const { t, locale } = await getI18n();
  let data: { subscriptions: BillingSubscription[]; payments: BillingPayment[] } | null = null;
  let tiers: { id: string; name: string }[] = [];
  try {
    const [billing, defs] = await Promise.all([getUserBilling(userId), canManage ? listCreatorTierDefinitions() : Promise.resolve([])]);
    data = billing;
    tiers = defs.map((x) => ({ id: x.id, name: tierLabel(x, locale) }));
  } catch (e) {
    logger.error('[payments] User billing failed to load', { userId, error: e instanceof Error ? e.message : String(e) });
  }
  const money = (amount: number, currency: string) => (
    <span dir="ltr">
      <span className="inline-block" dir="auto">
        {formatBillingAmount(amount, currency, locale)}
      </span>
    </span>
  );

  return (
    <section id="user-billing" className={`${cardClass} mb-6`} aria-labelledby="user-billing-title" data-testid="user-billing">
      <h2 id="user-billing-title" className="text-lg font-semibold text-fg mb-1">
        {t('payments.user.title')}
      </h2>
      <p className="text-sm text-fg-muted mb-4">{t('payments.user.hint')}</p>
      {!data ? (
        <ErrorAlert testId="user-billing-failed">{t('payments.user.loadFailed')}</ErrorAlert>
      ) : (
        <div className="space-y-4">
          {data.subscriptions.length === 0 && data.payments.length === 0 && <p className="text-sm text-fg-muted">{t('payments.user.none')}</p>}
          {data.subscriptions.length > 0 && (
            <div>
              <h3 className="font-medium text-fg mb-2">{t('payments.user.subscriptions')}</h3>
              <ul className="divide-y divide-border rounded border border-border">
                {data.subscriptions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm" data-testid="user-billing-subscription" data-status={s.status}>
                    <Link href={`/payments/subscriptions/${encodeURIComponent(s.id)}`} className={`${linkClass} font-medium`} dir="auto">
                      {tiers.find((x) => x.id === s.tierId)?.name ?? s.tierName}
                    </Link>
                    <span className="text-fg-muted">{providerName(t, s.provider)}</span>
                    <Chip tone={SUBSCRIPTION_TONE[s.status]}>{t(`payments.status.${s.status}`)}</Chip>
                    {(s.accessUntil ?? s.currentPeriodEnd) && <span className="text-fg-muted">{formatDate((s.accessUntil ?? s.currentPeriodEnd)!, locale)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.payments.length > 0 && (
            <div>
              <h3 className="font-medium text-fg mb-2">{t('payments.user.payments')}</h3>
              <ul className="divide-y divide-border rounded border border-border">
                {data.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm" data-testid="user-billing-payment">
                    <span className="text-fg-muted">{formatDate(p.occurredAt, locale, true)}</span>
                    <span className="font-medium text-fg">{money(p.amount, p.currency)}</span>
                    <Chip tone={PAYMENT_TONE[p.status]}>{t(`payments.paymentStatus.${p.status}`)}</Chip>
                    {p.subscriptionId && (
                      <Link href={`/payments/subscriptions/${encodeURIComponent(p.subscriptionId)}`} className={linkClass}>
                        {t('payments.subs.open')}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {canManage && <CompForm tiers={tiers} userId={userId} />}
        </div>
      )}
    </section>
  );
}
