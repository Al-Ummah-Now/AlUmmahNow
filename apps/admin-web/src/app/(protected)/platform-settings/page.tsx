import {
  getDownloadRateLimitHistory,
  getDownloadRateLimitSettings,
  getNotificationPlatformSettings,
  getQafSettings,
  saveQafSettings,
  getNotificationSettingsHistory,
  getYoutubeImportSettings,
  saveDownloadRateLimitSettings,
  saveYoutubeImportClientSecret,
  saveYoutubeImportSettings,
} from '@/lib/api/admin';
import { getAdminSession } from '@/lib/auth';
import { canManageMedia, canManagePlatformSettings, isSuperAdmin } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { NotificationMenuSetting } from './NotificationMenuSetting';
import { DownloadRateLimitSetting } from './DownloadRateLimitSetting';
import { QafSetting } from './QafSetting';
import { YoutubeImportSetting } from './YoutubeImportSetting';
import { featureStates, type FeatureStates } from '@/lib/features/states';

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
  const canEditPlatform = canManagePlatformSettings(session?.user.role);
  const showQaf = isSuperAdmin(session?.user.role);
  const [[settingsResult, historyResult, downloadRateLimitResult, downloadRateLimitHistoryResult, youtubeResult, qafResult], features] = await Promise.all([
    Promise.allSettled([
      getNotificationPlatformSettings(),
      getNotificationSettingsHistory(),
      getDownloadRateLimitSettings(),
      getDownloadRateLimitHistory(),
      showYoutube ? getYoutubeImportSettings() : Promise.resolve(null),
      showQaf ? getQafSettings() : Promise.resolve(null),
    ]),
    showYoutube ? featureStates() : Promise.resolve({} as FeatureStates),
  ]);
  if (youtubeResult.status === 'rejected') {
    logger.error('[platform-settings] Could not load the YouTube import settings', { error: String(youtubeResult.reason) });
  }
  const youtube = youtubeResult.status === 'fulfilled' ? youtubeResult.value : null;
  if (settingsResult.status === 'rejected') {
    logger.error('[platform-settings] Could not load the notification settings', { error: String(settingsResult.reason) });
  }
  const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;
  const history = historyResult.status === 'fulfilled' ? historyResult.value.entries : [];
  if (downloadRateLimitResult.status === 'rejected') {
    logger.error('[platform-settings] Could not load the download rate limit settings', {
      error: String(downloadRateLimitResult.reason),
    });
  }
  const downloadRateLimit = downloadRateLimitResult.status === 'fulfilled' ? downloadRateLimitResult.value : null;
  const downloadRateLimitHistory =
    downloadRateLimitHistoryResult.status === 'fulfilled' ? downloadRateLimitHistoryResult.value.entries : [];

  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('platformSettings.title')}</h1>
        <p className="text-fg-muted mt-1">{t('platformSettings.subtitle')}</p>
      </div>
      {settings ? (
        <NotificationMenuSetting settings={settings} history={history} canEdit={canEditPlatform} />
      ) : (
        <ErrorAlert testId="platform-settings-error">{t('platformSettings.loadFailed')}</ErrorAlert>
      )}
      {downloadRateLimit ? (
        <DownloadRateLimitSetting
          settings={downloadRateLimit}
          history={downloadRateLimitHistory}
          canEdit={canEditPlatform}
          save={saveDownloadRateLimitSettings}
        />
      ) : (
        <ErrorAlert testId="download-rate-limit-error">{t('platformSettings.downloadRateLimitLoadFailed')}</ErrorAlert>
      )}
      {showQaf && (qafResult.status === 'fulfilled' && qafResult.value ? (
        <QafSetting initial={qafResult.value} save={saveQafSettings} />
      ) : (
        <ErrorAlert testId="qaf-settings-load-error">{t('qafSettings.loadFailed')}</ErrorAlert>
      ))}
      {showYoutube &&
        (youtube ? (
          <YoutubeImportSetting view={youtube} canEdit={canManageMedia(session?.user.role)} save={saveYoutubeImportSettings} saveSecret={saveYoutubeImportClientSecret} feature={features.youtubeImport} />
        ) : (
          <ErrorAlert testId="youtube-import-load-error">{t('youtubeImport.loadFailed')}</ErrorAlert>
        ))}
    </div>
  );
}
