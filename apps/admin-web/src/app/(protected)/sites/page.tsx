import { getAdminSession } from '@/lib/auth';
import { canManageCreators } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { listSites, type SiteListItem } from '@/lib/api/sites';
import { SitesView } from '@/components/sites/SitesView';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * White-label scholar sites (wiki AUN-SCHOLAR-SITES §8): every channel with the add-on, its
 * address, status, tier and limits; grant a site to a channel, change it, take it away (in-app
 * confirmation, restorable for 30 days). Every admin reads; creators:manage changes.
 */
export default async function SitesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.slice(0, 100) : '';
  const { t } = await getI18n();
  const session = await getAdminSession();
  const canManage = canManageCreators(session?.user.role);
  let sites: SiteListItem[] | null = null;
  try {
    sites = await listSites(q);
  } catch (e) {
    logger.error('[sites] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }
  return <SitesView sites={sites} q={q} canManage={canManage} title={t('scholarSites.title')} />;
}
