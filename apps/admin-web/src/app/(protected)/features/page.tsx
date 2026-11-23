import { getI18n } from '@/i18n/server';
import { featureHistory, listFeatures, setFeature, type FeatureItem } from '@/lib/api/features';
import { getAdminSession } from '@/lib/auth';
import { normalizeRole } from '@/lib/roles';
import { logger } from '@/lib/logger';
import { FeaturesView } from '@/components/features/FeaturesView';
import { FeaturesLoadError } from '@/components/features/FeaturesLoadError';

export const dynamic = 'force-dynamic';

/**
 * Features (wiki AUN-FEATURES §3–§4, decision O39): every feature that can be switched on or off,
 * on one page. Every admin role opens it (features:read); admins and super admins change switches
 * (features:manage), and super-admin-only rows are locked for admins. admin-api checks every write.
 */
export default async function FeaturesPage() {
  const { t } = await getI18n();
  const session = await getAdminSession();
  const role = normalizeRole(session?.user.role);
  const canManage = role === 'admin' || role === 'super_admin';
  let items: FeatureItem[] | null = null;
  try {
    items = await listFeatures();
  } catch (error) {
    logger.error('[features] Failed to load the features', { error: error instanceof Error ? error.message : String(error) });
  }
  if (!items) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-fg">{t('features.title')}</h1>
          <p className="mt-2 max-w-prose text-fg-muted">{t('features.intro')}</p>
        </div>
        <FeaturesLoadError />
      </div>
    );
  }
  const me = { id: session?.user.id ?? '', name: session?.user.displayName || session?.user.email || '' };
  return <FeaturesView initial={items} canManage={canManage} me={me} actions={{ setFeature, featureHistory }} />;
}
