import type { AdminAuditEntry, CreatorTiersList } from '@al-ummah/shared-types';
import { creatorTierAudit, deleteCreatorTier, listCreatorTiers, reorderCreatorTiers, saveCreatorTier, setDefaultCreatorTier } from '@/lib/api/creators';
import { openWorkflowRequests } from '@/lib/api/workflows';
import type { PendingRequests } from '@/lib/workflows';
import { getAdminSession } from '@/lib/auth';
import { canManageCreators } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { CreatorTiersView } from '@/components/creators/CreatorTiersView';
import { logger } from '@/lib/logger';
import Link from '@/components/AppLink';
import { linkClass } from '@/components/ui';
import { trashHref } from '@/lib/trash';

export const dynamic = 'force-dynamic';

/** Tier definitions (name, limits, channel limit), editable by admins, with how many users hold each and their recent changes. */
export default async function CreatorTiersPage() {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  const canManage = canManageCreators(session?.user.role);
  let list: CreatorTiersList | null = null;
  let audit: AdminAuditEntry[] = [];
  let pending: PendingRequests = {};
  try {
    [list, audit] = await Promise.all([listCreatorTiers(), creatorTierAudit().catch(() => [])]);
    if (canManage) pending = await openWorkflowRequests('tiers.change', ['creator-tiers:setDefault', 'creator-tiers:reorder', ...list.items.map((tier) => `creator-tier:${tier.id}`)]);
  } catch (e) {
    logger.error('[creators] Failed to load tiers', { error: e instanceof Error ? e.message : String(e) });
  }
  return (
    <>
      <CreatorTiersView list={list} audit={audit} canManage={canManage} pending={pending} t={t} locale={locale} actions={{ save: saveCreatorTier, remove: deleteCreatorTier, setDefault: setDefaultCreatorTier, reorder: reorderCreatorTiers }} />
      {canManage && (
        <p className="mt-6">
          <Link href={trashHref('creator-tier')} className={linkClass} data-testid="tiers-recently-deleted">
            {t('trash.link')}
          </Link>
        </p>
      )}
    </>
  );
}
