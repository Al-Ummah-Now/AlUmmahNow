import { redirect } from 'next/navigation';
import type { AdminBillingSubscriptionDetail } from '@al-ummah/shared-types';
import { getAdminSession } from '@/lib/auth';
import { canManageBilling, canReadBilling, canRefund } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { BackLink } from '@/components/content/parts';
import { getBillingSubscription } from '@/lib/api/billing';
import { AdminApiError } from '@/lib/api/errors';
import { SubscriptionDetail } from '@/components/payments/SubscriptionDetail';
import { listCreatorTierDefinitions } from '@/lib/api/creators';
import { tierLabel } from '@/lib/creator-tiers';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** One subscription (wiki AUN-SUBS): its details, payments with refunds, webhook events and cancel. */
export default async function SubscriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await getI18n();
  const role = (await getAdminSession())?.user.role;
  if (!canReadBilling(role)) redirect('/access-denied');
  const back = <BackLink href="/payments?tab=subscriptions" label={t('payments.detail.back')} />;

  let detail: AdminBillingSubscriptionDetail | null = null;
  let missing = false;
  try {
    detail = await getBillingSubscription(id);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) missing = true;
    else logger.error('[payments] Failed to load subscription', { id, error: e instanceof Error ? e.message : String(e) });
  }
  if (!detail) {
    return (
      <div>
        {back}
        <ErrorAlert testId="payments-detail-error">{missing ? t('payments.detail.notFound') : t('payments.detail.loadFailed')}</ErrorAlert>
      </div>
    );
  }

  // The tier in the admin's language (Arabic name in Arabic; the stored name if the tier is gone)
  const tier = (await listCreatorTierDefinitions().catch(() => [])).find((x) => x.id === detail!.subscription.tierId);
  if (tier) detail = { ...detail, subscription: { ...detail.subscription, tierName: tierLabel(tier, locale) } };
  return <SubscriptionDetail detail={detail} back={back} can={{ manage: canManageBilling(role), refund: canRefund(role) }} />;
}
