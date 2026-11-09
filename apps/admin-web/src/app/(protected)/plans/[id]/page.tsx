import Link from 'next/link';
import type { EntitlementDefinition } from '@al-ummah/shared-types';
import { getEntitlementCatalogue, getPlan } from '@/lib/api/admin';
import type { PlanDetail } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import { ErrorAlert, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { PlanEditor } from './PlanEditor';

export const dynamic = 'force-dynamic';

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getI18n();
  let detail: PlanDetail | null = null;
  let catalogue: EntitlementDefinition[] = [];
  try {
    [detail, { catalogue }] = await Promise.all([getPlan(id), getEntitlementCatalogue()]);
  } catch (e) {
    logger.error('[plans] Failed to load plan', { id, error: e instanceof Error ? e.message : String(e) });
  }
  return (
    <div className="space-y-6">
      <Link href="/plans" className={linkClass}><span aria-hidden="true" className="inline-block rtl:rotate-180">&larr;</span> {t('plans.back')}</Link>
      {!detail && <ErrorAlert testId="plan-load-error">{t('plans.loadFailed')}</ErrorAlert>}
      {detail && <PlanEditor key={`${detail.plan.version}-${detail.plan.status}`} detail={detail} catalogue={catalogue} />}
    </div>
  );
}
