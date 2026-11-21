'use client';

/**
 * "Check again" on the refused-token banner (super admins): queues an hourly collection and
 * re-tests the admin token (admin-api POST /api/costs/collector/check). The collection takes a
 * minute or two, so the line says so; the page refreshes and shows the new state when it is in.
 */
import { useLanguage } from '@/i18n/I18nProvider';
import { checkCostCollector } from '@/lib/api/costs';
import { FeedbackLine, useCostAction } from './useCostAction';

export function CheckCollector() {
  const { t } = useLanguage();
  const { run, busy, feedback } = useCostAction('collector');
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        className="cost-primary inline-flex min-h-11 items-center rounded px-5 py-2.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-60"
        disabled={busy !== null}
        aria-busy={busy !== null}
        onClick={() => run('check', () => checkCostCollector(), () => t('costs.token.checkQueued'))}
        data-testid="costs-token-check"
      >
        {busy ? t('costs.token.checking') : t('costs.token.checkAgain')}
      </button>
      <FeedbackLine feedback={feedback} testId="costs-token-check-feedback" />
    </div>
  );
}
