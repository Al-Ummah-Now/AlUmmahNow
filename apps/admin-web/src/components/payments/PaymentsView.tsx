'use client';

/**
 * The Payments page's client part: holds the overview so each panel's change
 * can load it again, and renders the section the tab chose.
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminBillingFilter, AdminBillingSubscriptionsPage } from '@al-ummah/shared-types';
import type { BillingOverview } from '@/lib/api/billing';
import { billingRequest } from '@/lib/list/api-client';
import { logger } from '@/lib/logger-client';
import { ProvidersPanel } from './ProvidersPanel';
import { PricesPanel, type TierOption } from './PricesPanel';
import { TaxPanel } from './TaxPanel';
import { SubscriptionsPanel } from './SubscriptionsPanel';

export type PaymentsTab = 'providers' | 'prices' | 'tax' | 'subscriptions';

interface Props {
  tab: PaymentsTab;
  overview: BillingOverview;
  tiers: TierOption[];
  subscriptions: AdminBillingSubscriptionsPage | null;
  filter: AdminBillingFilter;
  can: { manage: boolean; providers: boolean };
}

export function PaymentsView({ tab, overview: initial, tiers, subscriptions, filter, can }: Props) {
  const router = useRouter();
  const [overview, setOverview] = useState(initial);

  // A failed reload keeps what is shown; the change itself already succeeded and said so
  const refresh = useCallback(async () => {
    try {
      setOverview(await billingRequest<BillingOverview>('GET', 'overview'));
    } catch (e) {
      logger.warn('[payments] Overview reload failed', { error: e instanceof Error ? e.message : String(e) });
    }
    // The header (on/off, counts) is rendered on the server
    router.refresh();
  }, [router]);

  if (tab === 'providers') return <ProvidersPanel providers={overview.providers} credentialStorage={overview.credentialStorage} canManage={can.providers} onRefresh={refresh} />;
  if (tab === 'prices') return <PricesPanel prices={overview.prices} tiers={tiers} providers={overview.providers} canManage={can.manage} canSync={can.providers} onRefresh={refresh} />;
  if (tab === 'tax') return <TaxPanel tax={overview.tax} canManage={can.manage} onRefresh={refresh} />;
  return <SubscriptionsPanel initial={subscriptions} initialFilter={filter} tiers={tiers} canManage={can.manage} />;
}
