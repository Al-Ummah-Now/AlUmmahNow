import { getNotificationPlatformSettings, getNotificationSettingsHistory } from '@/lib/api/admin';
import { getAdminSession } from '@/lib/auth';
import { canManagePlatformSettings } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { NotificationMenuSetting } from './NotificationMenuSetting';

export const dynamic = 'force-dynamic';

/**
 * Platform settings: site-wide behaviour of the videos site and apps. Every admin role reads it;
 * changing needs settings:manage (admins and super admins), audited in admin-api.
 */
export default async function PlatformSettingsPage() {
  const { t } = await getI18n();
  const session = await getAdminSession();
  const [settingsResult, historyResult] = await Promise.allSettled([getNotificationPlatformSettings(), getNotificationSettingsHistory()]);
  if (settingsResult.status === 'rejected') {
    logger.error('[platform-settings] Could not load the notification settings', { error: String(settingsResult.reason) });
  }
  const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;
  const history = historyResult.status === 'fulfilled' ? historyResult.value.entries : [];

  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('platformSettings.title')}</h1>
        <p className="text-fg-muted mt-1">{t('platformSettings.subtitle')}</p>
      </div>
      {settings ? (
        <NotificationMenuSetting settings={settings} history={history} canEdit={canManagePlatformSettings(session?.user.role)} />
      ) : (
        <ErrorAlert testId="platform-settings-error">{t('platformSettings.loadFailed')}</ErrorAlert>
      )}
    </div>
  );
}
