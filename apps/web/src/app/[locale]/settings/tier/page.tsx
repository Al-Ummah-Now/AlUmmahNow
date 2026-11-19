'use client';

/**
 * Settings › Tier (/en/settings/tier, /ar/settings/tier): the user's tier,
 * since when they hold it, what it allows, and every tier request they made
 * (wiki AUN-TIER-REQUESTS), with "See all tiers" in the card's footer (the owner
 * kept this link, 2026-11-16).
 */
import '@/theme/upgrade.css';
import { useEffect, useState } from 'react';
import { Check, Minus } from 'lucide-react';
import type { UpgradeOverview } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import Link from '@/components/common/AppLink';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import { TierRequestHistory } from '@/components/upgrade/TierRequestHistory';
import { QUIET } from '@/components/upgrade/buttons';
import { fetchMyTier } from '@/lib/api/tier-requests-client';
import { fillCopy, tierFeatures, tierName, type Lang } from '@/lib/upgrade/tiers';
import { formatAbsoluteDate } from '@/lib/format/videoMeta';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; overview: UpgradeOverview };

export default function SettingsTierPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const l: Lang = lang === 'ar' ? 'ar' : 'en';
  const copy = t.upgrade.settingsTier;
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    if (!user) return;
    let live = true;
    void fetchMyTier().then((res) => {
      if (!live) return;
      if (res.ok && res.result) return setLoad({ status: 'ready', overview: res.result });
      logger.warn('[settings-tier] Overview not loaded', { status: res.status, code: res.code });
      if (res.status === 0 || res.status >= 500) reportError(new Error(`Settings tier failed: ${res.status} ${res.code ?? ''}`.trim()), { kind: 'fetch', status: res.status, shown: true });
      setLoad({ status: 'error' });
    });
    return () => {
      live = false;
    };
  }, [user]);

  if (!user) return <SignInPrompt title={t.settings?.signInTitle || t.navigation.signIn} message={t.settings?.signInMessage || ''} />;

  const overview = load.status === 'ready' ? load.overview : null;
  const tier = overview?.tiers.find((x) => x.id === overview.currentTierId) ?? null;

  return (
    <main id={MAIN_CONTENT_ID} className="upg upg-settings" data-testid="settings-tier">
      <header className="upg-head">
        <h1 className="upg-title">{copy.title}</h1>
        <p className="upg-lead">{copy.description}</p>
      </header>

      {load.status === 'loading' && <div className="upg-card upg-card-skel" data-slot="card" aria-busy="true" />}
      {load.status === 'error' && <p className="upg-error" data-slot="card" role="alert" data-testid="settings-tier-error">{t.upgrade.errors.loadFailed}</p>}
      {overview && (
        <section className="upg-current" data-slot="card" aria-labelledby="settings-tier-current" data-testid="settings-tier-current">
          <div className="upg-current-head">
            <h2 id="settings-tier-current" className="upg-current-title" data-testid="settings-tier-name">
              {fillCopy(copy.current, { tier: tier ? tierName(tier, l) : '' })}
            </h2>
            {overview.currentTierSince && (
              <p className="upg-current-since" data-testid="settings-tier-since">{fillCopy(copy.since, { date: formatAbsoluteDate(overview.currentTierSince, l) })}</p>
            )}
          </div>
          {tier && (
            <ul className="upg-feats upg-current-feats">
              {tierFeatures(tier, t.upgrade, l).map((f) => (
                <li key={f.key} className="upg-feat" data-included={f.included}>
                  {f.included ? <Check className="upg-feat-icon" aria-hidden="true" /> : <Minus className="upg-feat-icon" aria-hidden="true" />}
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
          )}
          {/* The card's action, at its end edge like other card actions (owner kept it, 2026-11-16). Requests off and
              no provider: /upgrade is an off feature, so no link to it (owner decision 2026-11-19) */}
          {overview.mode !== 'closed' && (
            <div className="upg-current-foot">
              <Link href={`/${lang}/upgrade`} className={QUIET} data-slot="button" data-testid="settings-tier-see-all">{copy.seeTiers}</Link>
            </div>
          )}
        </section>
      )}

      {/* The request history belongs to /upgrade's requests: gone with it while closed */}
      {overview && overview.mode !== 'closed' && <TierRequestHistory tiers={overview.tiers} />}
    </main>
  );
}
