import Link from 'next/link';
import { listPlans } from '@/lib/api/admin';
import type { PlanRow } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import type { MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { CreatePlanForm } from './CreatePlanForm';

export const dynamic = 'force-dynamic';

const STATUS: Record<PlanRow['status'], MessageKey> = { draft: 'plans.statusDraft', active: 'plans.statusActive', archived: 'plans.statusArchived' };

export default async function PlansPage() {
  const { t, locale } = await getI18n();
  let plans: PlanRow[] | null = null;
  try {
    plans = (await listPlans()).plans;
  } catch (e) {
    logger.error('[plans] Failed to load plans', { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-fg mb-2">{t('plans.title')}</h1>
        <p className="text-fg-muted">{t('plans.intro')}</p>
        <p className="mt-2 flex flex-wrap gap-4">
          <Link href="/plans/subjects" className={linkClass}>{t('plans.assignments')}</Link>
          <Link href="/plans/audit" className={linkClass}>{t('plans.audit')}</Link>
        </p>
      </div>
      {!plans && <ErrorAlert testId="plans-load-error">{t('plans.loadFailed')}</ErrorAlert>}
      {plans && (
        <div className={`${cardClass} overflow-x-auto`}>
          <table className="w-full text-sm text-start" data-testid="plans-table">
            <thead className="text-fg-muted">
              <tr>
                <th className="py-2 pe-4 text-start">{t('plans.name')}</th>
                <th className="py-2 pe-4 text-start">{t('plans.status')}</th>
                <th className="py-2 pe-4 text-start">{t('plans.version')}</th>
                <th className="py-2 text-start">{t('plans.subscribers')}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-2 pe-4">
                    <Link href={`/plans/${encodeURIComponent(p.id)}`} className={linkClass}>{locale === 'ar' ? p.name_ar : p.name_en}</Link>
                    {p.is_default === 1 && <span className="ms-2 text-fg-muted">({t('plans.default')})</span>}
                  </td>
                  <td className="py-2 pe-4">{t(STATUS[p.status])}</td>
                  <td className="py-2 pe-4">{p.version}</td>
                  <td className="py-2">{p.subscribers ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plans && <CreatePlanForm plans={plans} />}
    </div>
  );
}
