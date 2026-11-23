'use client';

/**
 * What the Upgrade page does now (owner rule 2026-11-15, shared-types UPGRADE_MODES; O37): sells
 * tiers while a payment provider is on; otherwise the request form while "Tier requests" is on,
 * or no Upgrade page at all (404 feature_off, no links to it). The switch itself lives on the
 * Features page (wiki AUN-FEATURES §3); this card says its state and links there.
 */
import type { FeatureItem } from '@/lib/api/features';
import { useLanguage } from '@/i18n/I18nProvider';
import { cardClass } from '@/components/ui';
import { FeatureStatusLine } from '@/components/features/FeatureStatusLine';

export function UpgradePageMode({ allowed, providerEnabled, feature }: { allowed: boolean; providerEnabled: boolean; feature?: Pick<FeatureItem, 'effective'> | null }) {
  const { t } = useLanguage();
  const mode = providerEnabled ? 'pay' : allowed ? 'request' : 'closed';
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby="tier-requests-allow-title" data-testid="tier-requests-allow" data-mode={mode}>
      <h2 id="tier-requests-allow-title" className="text-lg font-semibold text-fg mb-2">{t('tierRequests.allowTitle')}</h2>
      <FeatureStatusLine featureKey="tierRequests" item={feature ?? { effective: allowed }} />
      <p id="tier-requests-allow-mode" className="mt-2 text-sm text-fg-muted" data-testid="tier-requests-allow-mode">
        {t(mode === 'pay' ? 'tierRequests.modePay' : mode === 'request' ? 'tierRequests.modeRequest' : 'tierRequests.modeClosed')}
      </p>
    </section>
  );
}
