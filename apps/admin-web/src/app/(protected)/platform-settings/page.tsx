import {
  getNotificationPlatformSettings,
  getNotificationSettingsHistory,
  getPlatformCredentials,
  getYoutubeImportSettings,
  replacePlatformCredential,
  saveYoutubeImportClientSecret,
  saveYoutubeImportSettings,
  testPlatformCredential,
} from '@/lib/api/admin';
import { getAdminSession } from '@/lib/auth';
import { canManageMedia, canManagePlatformSettings, isSuperAdmin } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { NotificationMenuSetting } from './NotificationMenuSetting';
import { YoutubeImportSetting } from './YoutubeImportSetting';
import { PlatformCredentialsSetting } from './PlatformCredentialsSetting';

export const dynamic = 'force-dynamic';

/**
 * Platform settings: site-wide behaviour of the videos site and apps. Every admin role reads it;
 * changing needs settings:manage (admins and super admins), audited in admin-api.
 */
export default async function PlatformSettingsPage() {
  const { t } = await getI18n();
  const session = await getAdminSession();
  // YouTube import (wiki AUN-YT-IMPORT): admin-api needs media:manage even to read it, so only those roles load it
  const showYoutube = canManageMedia(session?.user.role);
  // Credentials (Platform settings → Credentials): Super Admins only, here and in admin-api
  const showCredentials = isSuperAdmin(session?.user.role);
  const [settingsResult, historyResult, youtubeResult, credentialsResult] = await Promise.allSettled([
    getNotificationPlatformSettings(),
    getNotificationSettingsHistory(),
    showYoutube ? getYoutubeImportSettings() : Promise.resolve(null),
    showCredentials ? getPlatformCredentials() : Promise.resolve(null),
  ]);
  if (credentialsResult.status === 'rejected') {
    logger.error('[platform-settings] Could not load the credentials', { error: String(credentialsResult.reason) });
  }
  const credentials = credentialsResult.status === 'fulfilled' ? credentialsResult.value : null;
  if (youtubeResult.status === 'rejected') {
    logger.error('[platform-settings] Could not load the YouTube import settings', { error: String(youtubeResult.reason) });
  }
  const youtube = youtubeResult.status === 'fulfilled' ? youtubeResult.value : null;
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
      {showYoutube &&
        (youtube ? (
          <YoutubeImportSetting view={youtube} canEdit={canManageMedia(session?.user.role)} save={saveYoutubeImportSettings} saveSecret={saveYoutubeImportClientSecret} />
        ) : (
          <ErrorAlert testId="youtube-import-load-error">{t('youtubeImport.loadFailed')}</ErrorAlert>
        ))}
      {showCredentials &&
        (credentials ? (
          <PlatformCredentialsSetting views={credentials} replace={replacePlatformCredential} test={testPlatformCredential} />
        ) : (
          <ErrorAlert testId="platform-credentials-load-error">{t('platformCredentials.loadFailed')}</ErrorAlert>
        ))}
    </div>
  );
}
