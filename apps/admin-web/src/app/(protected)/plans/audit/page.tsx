import Link from 'next/link';
import { listPlanAudit } from '@/lib/api/admin';
import type { PlanAuditEntry } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export default async function PlanAuditPage() {
  const { t, locale } = await getI18n();
  let entries: PlanAuditEntry[] | null = null;
  try {
    entries = (await listPlanAudit()).entries;
  } catch (e) {
    logger.error('[plans] Failed to load audit log', { error: e instanceof Error ? e.message : String(e) });
  }
  return (
    <div className="space-y-6">
      <Link href="/plans" className={linkClass}><span aria-hidden="true" className="inline-block rtl:rotate-180">&larr;</span> {t('plans.back')}</Link>
      <h1 className="text-3xl font-bold text-fg">{t('plans.audit')}</h1>
      {!entries && <ErrorAlert testId="audit-error">{t('plans.loadFailed')}</ErrorAlert>}
      {entries?.length === 0 && <p className="text-fg-muted">{t('plans.noAudit')}</p>}
      {entries && entries.length > 0 && (
        <div className={`${cardClass} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="text-fg-muted">
              <tr>
                {(['plans.auditWhen', 'plans.auditWho', 'plans.auditWhat', 'plans.auditEntity', 'plans.auditWhy'] as const).map((k) => <th key={k} className="py-2 pe-4 text-start">{t(k)}</th>)}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border text-fg">
                  <td className="py-2 pe-4">{formatDate(e.created_at, locale, true)}</td>
                  <td className="py-2 pe-4" dir="ltr">{e.actor_id}</td>
                  <td className="py-2 pe-4" dir="ltr">{e.action}</td>
                  <td className="py-2 pe-4" dir="ltr">{e.entity_type}:{e.entity_id}</td>
                  <td className="py-2">{e.reason ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
