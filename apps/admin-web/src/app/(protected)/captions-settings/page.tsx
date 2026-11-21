import { getCaptionSettings, type CaptionSettingsView as View } from '@/lib/api/captions';
import { getAdminSession } from '@/lib/auth';
import { canManageCreators, isSuperAdmin } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { CaptionSettingsView } from '@/components/captions/CaptionSettingsView';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Captions & translation (AUN-CAPTIONS §10): budgets, translation models and DeepL, inline
 * translation's kill switch and fair use, viewer-side titles and the Quran translation editions.
 * Every admin reads it; creators:manage changes it (audited in admin-api). The DeepL API key is
 * super admins only (DeeplKeyPanel).
 */
export default async function CaptionSettingsPage() {
  const { t } = await getI18n();
  const session = await getAdminSession();
  let view: View | null = null;
  try {
    view = await getCaptionSettings();
  } catch (e) {
    logger.error('[caption-settings] Could not load the settings', { error: e instanceof Error ? e.message : String(e) });
  }
  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('captionSettings.title')}</h1>
        <p className="text-fg-muted mt-1">{t('captionSettings.subtitle')}</p>
      </div>
      {view ? <CaptionSettingsView view={view} canManage={canManageCreators(session?.user.role)} canManageDeeplKey={isSuperAdmin(session?.user.role)} /> : <ErrorAlert testId="caption-settings-load-error">{t('captionSettings.loadFailed')}</ErrorAlert>}
    </div>
  );
}
