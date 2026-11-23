import { shortLinkOriginFor } from '@al-ummah/shared-types';
import { getMobileApps, getMobileAppsHistory } from '@/lib/api/admin';
import { getAdminSession } from '@/lib/auth';
import { canManagePlatformSettings } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { MobileAppsForm } from './MobileAppsForm';

export const dynamic = 'force-dynamic';

/** `https://videos.api.qa.alummahnow.net` → `https://videos.qa.alummahnow.net`: where the files are served. */
function videosSiteUrl(apiUrl: string | undefined): string | null {
  if (!apiUrl) return null;
  try {
    const u = new URL(apiUrl);
    if (!u.host.startsWith('videos.api.')) return null;
    return `${u.protocol}//${u.host.replace(/^videos\.api\./, 'videos.')}`;
  } catch {
    return null;
  }
}

/**
 * Mobile apps (NAT-REL): the values the native apps' store releases need on the server side. The
 * videos site serves its universal links / App Links files from them (nothing until they are filled
 * in), and api-videos reads the attestation switches. Every admin role reads; admins and super admins
 * change it; each change is audited in admin-api.
 */
export default async function MobileAppsPage() {
  const { t } = await getI18n();
  const session = await getAdminSession();
  const [stateResult, historyResult] = await Promise.allSettled([getMobileApps(), getMobileAppsHistory()]);
  if (stateResult.status === 'rejected') logger.error('[mobile-apps] Could not load the settings', { error: String(stateResult.reason) });
  const state = stateResult.status === 'fulfilled' ? stateResult.value : null;
  const history = historyResult.status === 'fulfilled' ? historyResult.value : [];

  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('mobileApps.title')}</h1>
        <p className="text-fg-muted mt-1">{t('mobileApps.subtitle')}</p>
      </div>
      {state ? (
        <MobileAppsForm
          state={state}
          history={history}
          canEdit={canManagePlatformSettings(session?.user.role)}
          siteUrl={videosSiteUrl(process.env.API_URL)}
          shortLinkUrl={shortLinkOriginFor(videosSiteUrl(process.env.API_URL))}
        />
      ) : (
        <ErrorAlert testId="mobile-apps-error">{t('mobileApps.loadFailed')}</ErrorAlert>
      )}
    </div>
  );
}
