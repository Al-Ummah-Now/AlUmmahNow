import { getAgeRules, getAgeRulesHistory, saveAgeRules } from '@/lib/api/ageRules';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { AgeRulesForm } from '@/components/age-rules/AgeRulesForm';
import { AgeRulesChecks } from '@/components/age-rules/AgeRulesChecks';

export const dynamic = 'force-dynamic';

/**
 * Age rules (wiki E20 §5.2): how old an account must be for each thing, and whether the ageRules switch can be
 * turned on. Saving is for super admins and audited in admin-api.
 */
export default async function AgeRulesPage() {
  const { t } = await getI18n();
  const [viewResult, historyResult] = await Promise.allSettled([getAgeRules(), getAgeRulesHistory()]);
  if (viewResult.status === 'rejected') logger.error('[age-rules] Could not load the ages', { error: String(viewResult.reason) });
  const view = viewResult.status === 'fulfilled' ? viewResult.value : null;
  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('ageRules.title')}</h1>
        <p className="text-fg-muted mt-1">{t('ageRules.subtitle')}</p>
      </div>
      {view ? (
        <>
          <AgeRulesChecks checks={view.checks} switchOn={view.switchOn} />
          <AgeRulesForm key={view.version} view={view} history={historyResult.status === 'fulfilled' ? historyResult.value : null} save={saveAgeRules} />
        </>
      ) : (
        <ErrorAlert testId="age-rules-load-error">{t('ageRules.loadFailed')}</ErrorAlert>
      )}
    </div>
  );
}
