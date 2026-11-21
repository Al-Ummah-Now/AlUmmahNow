import type { DiscoveryAdminState } from '@al-ummah/shared-types';
import { discoveryHistory, getDiscoveryState, type DiscoveryHistoryEntry } from '@/lib/api/discovery';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { DiscoveryAdmin } from './DiscoveryAdmin';

export const dynamic = 'force-dynamic';

/**
 * Videos admin › Discovery (wiki E07 "Discovery ranking"): what each ranked list shows now and
 * why (cold start: Trending reads "New this week" until real viewers arrive), rank now, the home
 * page's rail order, pins, exclusions, a preview of any list, and the latest changes. Every admin
 * role reads; changes need discovery:manage (admins and super admins), audited in admin-api.
 */
export default async function DiscoveryPage() {
  const { t } = await getI18n();
  let state: DiscoveryAdminState | null = null;
  let history: DiscoveryHistoryEntry[] = [];
  try {
    [state, history] = await Promise.all([getDiscoveryState(), discoveryHistory(20).catch(() => [])]);
  } catch (error) {
    logger.error('[discovery] Failed to load', { error: error instanceof Error ? error.message : String(error) });
  }

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('discovery.title')}</h1>
        <p className="text-fg-muted mt-1">{t('discovery.subtitle')}</p>
      </div>
      {state ? <DiscoveryAdmin initial={state} history={history} /> : <ErrorAlert testId="discovery-load-error">{t('discovery.loadError')}</ErrorAlert>}
    </div>
  );
}
