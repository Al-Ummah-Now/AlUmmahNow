import type { AppConfigDocumentKey } from '@al-ummah/shared-types';
import { getAppConfigDocument, getAppConfigHistory, getAppReleases, type AppConfigHistoryEntry } from '@/lib/api/appConfig';
import { getAdminSession } from '@/lib/auth';
import { canManagePlatformSettings, isSuperAdmin } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { AppConfigEditor } from '@/components/app-config/AppConfigEditor';

export const dynamic = 'force-dynamic';

const KEYS: AppConfigDocumentKey[] = ['flags', 'config', 'versions'];

/**
 * Remote config (issue #413): the feature flags, settings and update policy the native apps read,
 * and the app releases (wiki AUN-APP-UPDATES §4.2). settings:manage (admins and super admins); the
 * versions document and Available marks are super admins' (issue #1434). Every save is audited in admin-api.
 */
export default async function AppConfigPage() {
  const { t } = await getI18n();
  const session = await getAdminSession();
  const header = (
    <div className="mb-6 max-w-3xl">
      <h1 className="text-3xl font-bold text-fg">{t('appConfig.title')}</h1>
      <p className="text-fg-muted mt-1">{t('appConfig.subtitle')}</p>
    </div>
  );
  if (!canManagePlatformSettings(session?.user.role)) {
    return (
      <div>
        {header}
        <ErrorAlert testId="app-config-no-access">{t('appConfig.noAccess')}</ErrorAlert>
      </div>
    );
  }

  const [documents, histories, releases] = await Promise.all([
    Promise.allSettled(KEYS.map((k) => getAppConfigDocument(k))),
    Promise.allSettled(KEYS.map((k) => getAppConfigHistory(k))),
    getAppReleases().then(
      (value) => ({ ok: true as const, value }),
      (error) => {
        logger.error('[app-config] Could not load the releases', { error: String(error) });
        return { ok: false as const, value: null };
      },
    ),
  ]);
  const failed = documents.find((r) => r.status === 'rejected');
  if (failed) {
    logger.error('[app-config] Could not load the documents', { error: String((failed as PromiseRejectedResult).reason) });
    return (
      <div>
        {header}
        <ErrorAlert testId="app-config-error">{t('appConfig.loadFailed')}</ErrorAlert>
      </div>
    );
  }
  const initial = Object.fromEntries(KEYS.map((k, i) => [k, (documents[i] as PromiseFulfilledResult<unknown>).value])) as Record<AppConfigDocumentKey, unknown>;
  const history = Object.fromEntries(KEYS.map((k, i) => [k, histories[i].status === 'fulfilled' ? histories[i].value : []])) as Record<AppConfigDocumentKey, AppConfigHistoryEntry[]>;

  return (
    <div>
      {header}
      <AppConfigEditor initial={initial} history={history} releases={releases.value} releasesFailed={!releases.ok} canEditVersions={isSuperAdmin(session?.user.role)} />
    </div>
  );
}
