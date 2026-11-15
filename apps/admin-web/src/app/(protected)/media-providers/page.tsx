import Link from '@/components/AppLink';
import { getMediaProviders, getTranscodeLimit } from '@/lib/api/admin';
import { getAdminSession } from '@/lib/auth';
import { canManageMedia } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { ErrorAlert, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { ProviderSettings } from './ProviderSettings';
import { R2Settings } from './R2Settings';

export const dynamic = 'force-dynamic';

const TITLE_ID = 'media-providers-title';

/**
 * Video providers (docs/media-delivery/PROVIDERS.md): which providers take uploads (with per-channel
 * overrides) and serve playback, health thresholds and thumbnails. The measurements live on the
 * Delivery page; each page links to the other. Media:manage only. Cloudflare R2's settings (max concurrent
 * transcodes, R2Settings.tsx) sit under the provider settings.
 */
export default async function MediaProvidersPage() {
  const { t } = await getI18n();
  const session = await getAdminSession();
  if (!canManageMedia(session?.user.role)) {
    return <ErrorAlert testId="providers-no-access">{t('mediaProviders.noAccess')}</ErrorAlert>;
  }

  const [providers, limit] = await Promise.all([
    getMediaProviders().catch((error: unknown) => {
      logger.error('[media-providers] Failed to load provider settings', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }),
    getTranscodeLimit(),
  ]);
  if (!limit.ok) logger.warn('[media-providers] Transcode limit unavailable', { status: limit.status });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 id={TITLE_ID} className="text-3xl font-bold text-fg">{t('mediaProviders.title')}</h1>
          <p className="text-fg-muted mt-1">{t('mediaProviders.intro')}</p>
        </div>
        <Link href="/delivery" className={`${linkClass} text-sm`} data-testid="providers-delivery-link">
          {t('mediaProviders.deliveryLink')}
        </Link>
      </div>

      {providers ? (
        <ProviderSettings view={providers} labelledBy={TITLE_ID} />
      ) : (
        <ErrorAlert testId="providers-load-error">{t('mediaProviders.loadFailed')}</ErrorAlert>
      )}

      {/* Cloudflare R2's own settings (max concurrent transcodes); Delivery's live figure links here */}
      <R2Settings initial={limit.ok ? limit.data : null} />
    </div>
  );
}
