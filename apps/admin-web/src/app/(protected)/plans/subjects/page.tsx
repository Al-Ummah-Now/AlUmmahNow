import Link from 'next/link';
import type { EntitlementDefinition } from '@al-ummah/shared-types';
import { getEntitlementCatalogue, getSubject, listPlans } from '@/lib/api/admin';
import type { PlanRow, SubjectState } from '@/lib/api/types';
import { getI18n } from '@/i18n/server';
import { ErrorAlert, cardClass, fieldClass, linkClass, primaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { SubjectManager } from './SubjectManager';

export const dynamic = 'force-dynamic';

const VALID = /^(user|channel):\S+$/;

export default async function SubjectsPage({ searchParams }: { searchParams: Promise<{ subject?: string }> }) {
  const { t } = await getI18n();
  const subject = (await searchParams).subject?.trim() ?? '';
  const valid = VALID.test(subject);
  let state: SubjectState | null = null;
  let plans: PlanRow[] = [];
  let catalogue: EntitlementDefinition[] = [];
  let failed = false;
  if (valid) {
    try {
      [state, { plans }, { catalogue }] = await Promise.all([getSubject(subject), listPlans(), getEntitlementCatalogue()]);
    } catch (e) {
      failed = true;
      logger.error('[plans] Failed to load subject', { error: e instanceof Error ? e.message : String(e) });
    }
  }
  return (
    <div className="space-y-6">
      <Link href="/plans" className={linkClass}><span aria-hidden="true" className="inline-block rtl:rotate-180">&larr;</span> {t('plans.back')}</Link>
      <h1 className="text-3xl font-bold text-fg">{t('plans.assignments')}</h1>
      <form method="get" className={`${cardClass} space-y-3`}>
        <label className="block text-sm text-fg">{t('plans.find')}
          <input name="subject" required dir="ltr" defaultValue={subject} className={fieldClass} data-testid="subject-input" />
        </label>
        <p className="text-sm text-fg-muted">{t('plans.subjectHelp')}</p>
        <button type="submit" className={primaryButtonClass} data-testid="subject-open">{t('plans.findButton')}</button>
      </form>
      {subject && !valid && <ErrorAlert testId="subject-invalid">{t('plans.subjectInvalid')}</ErrorAlert>}
      {failed && <ErrorAlert testId="subject-error">{t('plans.loadFailed')}</ErrorAlert>}
      {state && <SubjectManager key={subject} subject={subject} state={state} plans={plans.filter((p) => p.status === 'active')} catalogue={catalogue} />}
    </div>
  );
}
