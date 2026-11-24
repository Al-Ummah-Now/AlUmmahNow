import { getCostDatabases, getCostsDashboard } from '@/lib/api/costs';
import type { CostDatabases, CostsDashboard } from '@/lib/api/costs-types';
import { AdminApiError } from '@/lib/api/errors';
import { getAdminSession } from '@/lib/auth';
import { canReadOps } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import type { Translator } from '@/i18n/translate';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { opsFormats } from '../operations/model';
import { BudgetNotice, BudgetSection, CollectorFailures, CostsHeader, EnvsPanel, MoversSection, ProductsPanel, TokenNotice, TrendPanel } from './sections';
import { CostThresholds, MyCostAlerts } from './CostAlertForms';
import { CostConnections } from './CostConnections';
import { DatabasesSection } from './DatabasesSection';
import { DatabaseSettings } from './DatabaseSettings';

export const dynamic = 'force-dynamic';

function loadError(error: unknown, t: Translator): string {
  if (error instanceof AdminApiError && error.status === 503) return error.code === 'not_ready' ? t('costs.notReady') : t('costs.notConfigured');
  return t('costs.loadFailed');
}

/**
 * Costs (COST-1, owner: "build infra, set a place in admin to set token"): month to date against
 * the budget with the forecast and open cost alerts, the breakdown by product and environment,
 * the 30-day trend, top movers, the admin's own alert emails and, for super admins (ops:manage),
 * the alert settings and the collector's connections. Data: admin-api GET /api/costs (ops:read).
 */
export default async function CostsPage() {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  if (!canReadOps(session?.user.role)) return <ErrorAlert testId="costs-no-access">{t('costs.noAccess')}</ErrorAlert>;

  let d: CostsDashboard | null = null;
  let databases: CostDatabases | null = null;
  let error = '';
  try {
    [d, databases] = await Promise.all([
      getCostsDashboard(),
      // Its own failure (say, before cost-monitor migration 0004) leaves the rest of the page working
      getCostDatabases().catch((e) => {
        logger.error('[costs] Failed to load the databases', { error: e instanceof Error ? e.message : String(e), status: e instanceof AdminApiError ? e.status : undefined });
        return null;
      }),
    ]);
  } catch (e) {
    logger.error('[costs] Failed to load the dashboard', { error: e instanceof Error ? e.message : String(e), status: e instanceof AdminApiError ? e.status : undefined });
    error = loadError(e, t);
  }
  const f = opsFormats(locale);
  const now = new Date();

  return (
    <div className="space-y-6" data-testid="costs-page">
      <CostsHeader d={d} t={t} f={f} now={now} />
      {error && <ErrorAlert testId="costs-load-error">{error}</ErrorAlert>}
      {d && (
        <>
          <TokenNotice d={d} t={t} />
          <BudgetNotice d={d} t={t} />
          <CollectorFailures d={d} t={t} f={f} />
          <BudgetSection d={d} t={t} f={f} />
          {/* Side by side only on very wide screens: at 1280-1440 px the product table's last column was cut off */}
          <div className="grid grid-cols-1 gap-6 min-[1800px]:grid-cols-5">
            <div className="min-w-0 min-[1800px]:col-span-3"><ProductsPanel d={d} t={t} f={f} locale={locale} /></div>
            <div className="min-w-0 min-[1800px]:col-span-2"><EnvsPanel d={d} t={t} f={f} /></div>
          </div>
          <TrendPanel d={d} t={t} f={f} locale={locale} />
          <MoversSection d={d} t={t} locale={locale} />
          {databases && <DatabasesSection data={databases} t={t} f={f} settings={databases.canManage ? <DatabaseSettings data={databases} /> : null} />}
          <div className={`grid grid-cols-1 gap-6 ${d.canManage ? 'xl:grid-cols-5' : ''}`}>
            <div className={`min-w-0 ${d.canManage ? 'xl:col-span-2' : 'max-w-2xl'}`}>
              <MyCostAlerts me={d.me} accountEmail={session?.user.email ?? null} digest={d.settings} />
            </div>
            {d.canManage && (
              <div className="min-w-0 xl:col-span-3">
                <CostThresholds settings={d.settings} />
              </div>
            )}
          </div>
          {d.canManage && <CostConnections connections={d.connections} />}
        </>
      )}
    </div>
  );
}
