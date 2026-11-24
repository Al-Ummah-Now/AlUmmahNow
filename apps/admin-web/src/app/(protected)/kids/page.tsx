import { getI18n } from '@/i18n/server';
import { ErrorAlert, cardClass } from '@/components/ui';
import {
  createKidsCatalogItem,
  decideKidsReviewRequest,
  deleteKidsCatalogItem,
  getKidsPolicyAdmin,
  listKidsCatalogAdmin,
  listKidsReviewRequestsAdmin,
  restoreKidsCatalogItem,
  searchKidsStaffPlaylistsAdmin,
  updateKidsCatalogItem,
  updateKidsPolicyAdmin,
} from '@/lib/api/kids';
import { isKidsTableMissing, type KidsAdminActions, type KidsPageTab } from '@/lib/api/kids-types';
import { logger } from '@/lib/logger';
import { KidsAdmin } from './KidsAdmin';

export const dynamic = 'force-dynamic';

const actions: KidsAdminActions = {
  listCatalog: listKidsCatalogAdmin,
  createCatalog: createKidsCatalogItem,
  updateCatalog: updateKidsCatalogItem,
  deleteCatalog: deleteKidsCatalogItem,
  restoreCatalog: restoreKidsCatalogItem,
  searchStaffPlaylists: searchKidsStaffPlaylistsAdmin,
  listReviews: listKidsReviewRequestsAdmin,
  decideReview: decideKidsReviewRequest,
  updatePolicy: updateKidsPolicyAdmin,
};

/**
 * Videos admin › Ummah Kids (wiki E20): curated allowlist catalog (videos & staff playlists),
 * creator review queue, and owner-decision/legal launch readiness. Staff setup stays open
 * while `ummahKids` is OFF (B1).
 */
export default async function KidsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { t } = await getI18n();
  const { tab } = await searchParams;
  const initialTab: KidsPageTab = tab === 'reviews' || tab === 'policy' ? tab : 'catalog';

  let tablesMissing = false;
  let loaded: {
    catalog: Awaited<ReturnType<typeof listKidsCatalogAdmin>>;
    reviews: Awaited<ReturnType<typeof listKidsReviewRequestsAdmin>>;
    policy: Awaited<ReturnType<typeof getKidsPolicyAdmin>>;
  } | null = null;

  try {
    const [catalog, reviews, policy] = await Promise.all([
      listKidsCatalogAdmin(),
      listKidsReviewRequestsAdmin({ status: 'pending' }),
      getKidsPolicyAdmin(),
    ]);
    loaded = { catalog, reviews, policy };
  } catch (error) {
    if (isKidsTableMissing(error)) {
      tablesMissing = true;
    } else {
      logger.error('[kids] Failed to load', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('kids.title')}</h1>
        <p className="text-fg-muted mt-1">{t('kids.subtitle')}</p>
      </div>

      {tablesMissing ? (
        <section className={`${cardClass} max-w-3xl space-y-2`} data-testid="kids-tables-missing">
          <h2 className="text-lg font-semibold text-fg">{t('kids.tablesMissingTitle')}</h2>
          <p className="text-sm text-fg-muted">{t('kids.tablesMissingBody')}</p>
        </section>
      ) : loaded ? (
        <KidsAdmin
          initialTab={initialTab}
          actions={actions}
          catalog={loaded.catalog}
          reviews={loaded.reviews}
          policy={loaded.policy}
        />
      ) : (
        <ErrorAlert testId="kids-load-error">{t('kids.loadFailed')}</ErrorAlert>
      )}
    </div>
  );
}
