import type { AdminCreatorsPage, CreatorTiersList } from '@al-ummah/shared-types';
import { bulkSetCreatorTier, listCreators, listCreatorTiers, setUserCreatorTier } from '@/lib/api/creators';
import { getAdminSession } from '@/lib/auth';
import { canManageCreators } from '@/lib/roles';
import { parseCreatorsQuery } from '@/lib/creator-tiers';
import { getI18n } from '@/i18n/server';
import { CreatorsView } from '@/components/creators/CreatorsView';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Who may upload and create channels: every videos user with their tier,
 * where it came from, their channels, uploads and limit hits. Users with
 * content but no tier come first, marked "Needs tier", with "Make Creator".
 * Each change (one row or the selected rows) is confirmed with its effect.
 */
export default async function CreatorsPage({ searchParams }: PageProps) {
  const query = parseCreatorsQuery(await searchParams);
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  const canManage = canManageCreators(session?.user.role);

  let data: AdminCreatorsPage | null = null;
  let tiers: CreatorTiersList | null = null;
  try {
    [data, tiers] = await Promise.all([listCreators({ q: query.q, filter: query.filter, tier: query.tier, page: query.page }), listCreatorTiers()]);
  } catch (e) {
    logger.error('[creators] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }
  return <CreatorsView data={data} tiers={tiers} query={query} canManage={canManage} t={t} locale={locale} setTier={setUserCreatorTier} bulkSetTier={bulkSetCreatorTier} />;
}
