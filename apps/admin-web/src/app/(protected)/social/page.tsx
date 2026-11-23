import { getSocialAdmin, getSocialHistory } from '@/lib/api/admin';
import { getAdminSession } from '@/lib/auth';
import { canManagePlatformSettings } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { SocialPostingView } from './SocialPostingView';
import { featureStates } from '@/lib/features/states';

export const dynamic = 'force-dynamic';

/**
 * Social posting (wiki AUN-SOCIAL, SOC-1; owner 2026-11-14: X, Telegram, Bluesky and Mastodon, no Meta): the
 * platform kill switches, the X spend cap, the X app and Telegram bot setup, 7-day activity and failures.
 * Every admin role reads it; changing needs settings:manage, audited in admin-api.
 */
export default async function SocialPostingPage() {
  const { t } = await getI18n();
  const session = await getAdminSession();
  const [[viewResult, historyResult], features] = await Promise.all([Promise.allSettled([getSocialAdmin(), getSocialHistory()]), featureStates()]);
  if (viewResult.status === 'rejected') logger.error('[social] Could not load the social posting settings', { error: String(viewResult.reason) });
  const view = viewResult.status === 'fulfilled' ? viewResult.value : null;
  const history = historyResult.status === 'fulfilled' ? historyResult.value.entries : [];

  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('socialPosting.title')}</h1>
        <p className="text-fg-muted mt-1">{t('socialPosting.subtitle')}</p>
      </div>
      {view ? (
        <SocialPostingView view={view} history={history} canEdit={canManagePlatformSettings(session?.user.role)} features={features} />
      ) : (
        <ErrorAlert testId="social-posting-error">{t('socialPosting.loadFailed')}</ErrorAlert>
      )}
    </div>
  );
}
