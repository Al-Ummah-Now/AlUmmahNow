import { redirect } from 'next/navigation';
import { ADMIN_BILLING_FILTERS, type AdminBillingFilter } from '@al-ummah/shared-types';
import { getAdminSession } from '@/lib/auth';
import { canManageBilling, canManageProviders, canReadBilling } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { getBillingOverview, listBillingSubscriptions, type BillingOverview } from '@/lib/api/billing';
import { listCreatorTierDefinitions } from '@/lib/api/creators';
import { PaymentsView, type PaymentsTab } from '@/components/payments/PaymentsView';
import { PAYMENTS_TABS, PaymentsHeader } from '@/components/payments/PaymentsHeader';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Payments (wiki AUN-SUBS): payment providers, tier prices, tax and seller
 * details, and subscriptions. Off by default: while no provider is on, the
 * videos site's /upgrade takes tier requests only. billing:read opens the
 * page; each change needs its own billing permission (admin-api checks it,
 * audits it and asks for a step-up on the risky ones).
 */
export default async function PaymentsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { t, locale } = await getI18n();
  const role = (await getAdminSession())?.user.role;
  if (!canReadBilling(role)) redirect('/access-denied');

  const tab = PAYMENTS_TABS.includes(params.tab as PaymentsTab) ? (params.tab as PaymentsTab) : 'providers';
  const filter = (ADMIN_BILLING_FILTERS as readonly string[]).includes(String(params.filter)) ? (params.filter as AdminBillingFilter) : 'active';

  const fail = (part: string) => (e: unknown) => {
    logger.error('[payments] Failed to load', { part, error: e instanceof Error ? e.message : String(e) });
    return null;
  };
  const [overview, tiers, subscriptions] = await Promise.all([
    getBillingOverview().catch(fail('overview')) as Promise<BillingOverview | null>,
    tab === 'prices' || tab === 'subscriptions' ? listCreatorTierDefinitions().catch(fail('tiers')) : Promise.resolve([]),
    tab === 'subscriptions' ? listBillingSubscriptions({ filter }).catch(fail('subscriptions')) : Promise.resolve(null),
  ]);

  return (
    <div>
      <PaymentsHeader overview={overview} tab={tab} />

      {!overview ? (
        <ErrorAlert testId="payments-error">{t('payments.loadFailed')}</ErrorAlert>
      ) : (
        <PaymentsView
          key={`${tab}-${filter}`}
          tab={tab}
          overview={overview}
          tiers={(tiers ?? []).map((x) => ({ id: x.id, name: locale === 'ar' && x.nameAr ? x.nameAr : x.name }))}
          subscriptions={subscriptions}
          filter={filter}
          can={{ manage: canManageBilling(role), providers: canManageProviders(role) }}
        />
      )}
    </div>
  );
}
