import { getReviewAlertSettings, getReviewAlertTimings } from '@/lib/api/admin';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { ReviewAlertsAdmin } from './ReviewAlertsAdmin';

export const dynamic = 'force-dynamic';

/**
 * Review alerts for the native Admin app (wiki AUN-ADMIN-NATIVE): the on-call rota and
 * escalation (every admin role reads, review_alerts:manage changes; audited), the daily time to
 * decision, and each staff member's devices with "Sign out this device".
 */
export default async function ReviewAlertsPage() {
  const { t } = await getI18n();
  const [settingsResult, timingsResult] = await Promise.allSettled([getReviewAlertSettings(), getReviewAlertTimings(14)]);
  if (settingsResult.status === 'rejected') logger.error('[review-alerts] Could not load the settings', { error: String(settingsResult.reason) });
  if (timingsResult.status === 'rejected') logger.warn('[review-alerts] Could not load the timings', { error: String(timingsResult.reason) });

  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('reviewAlerts.title')}</h1>
        <p className="text-fg-muted mt-1">{t('reviewAlerts.subtitle')}</p>
      </div>
      {settingsResult.status === 'fulfilled' ? (
        <ReviewAlertsAdmin view={settingsResult.value} timings={timingsResult.status === 'fulfilled' ? timingsResult.value.days : null} />
      ) : (
        <ErrorAlert testId="review-alerts-error">{t('reviewAlerts.loadFailed')}</ErrorAlert>
      )}
    </div>
  );
}
