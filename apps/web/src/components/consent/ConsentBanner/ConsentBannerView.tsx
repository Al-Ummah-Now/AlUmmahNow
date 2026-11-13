'use client';

/**
 * Shared consent banner implementation for the LTR and RTL variants.
 *
 * GDPR / ePrivacy requirements implemented here:
 * - Shown until the user decides; nothing optional runs before that (default deny).
 * - "Reject all" is as prominent and as easy as "Accept all" (one click each).
 * - Granular per-category choices, reachable from the banner.
 * - Reopenable later (ConsentManager.openPreferences) to change or withdraw consent.
 *
 * First paint (#1205): the root layout reads the consent cookie and passes
 * `initialVisible`, so a first visit gets the bar in the server HTML. A bar that
 * only appeared after hydration became the page's Largest Contentful Paint on
 * light pages. It is a compact fixed bar (never pushes content, so no layout
 * shift), and its buttons report aria-disabled until hydrated, since they only
 * work once React is running (the settings link works at once).
 */

import React, { useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { useLanguage } from '@/hooks/useLanguage';
import { ConsentManager, type ConsentChoices } from '@/lib/consent/ConsentManager';
import { ConsentPreferences } from '../ConsentPreferences';

export interface ConsentBannerViewProps {
  dir: 'ltr' | 'rtl';
  /** Server decision from the request's consent cookie: true when no valid choice is stored. */
  initialVisible?: boolean;
}

const NONE: ConsentChoices = { analytics: false, experiments: false, performance: false };

export function ConsentBannerView({ dir, initialVisible = false }: ConsentBannerViewProps) {
  const { t, lang } = useLanguage();
  const p = t.privacy;
  const [visible, setVisible] = useState(initialVisible);
  const [hydrated, setHydrated] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [choices, setChoices] = useState<ConsentChoices>(NONE);

  useEffect(() => {
    setHydrated(true);
    // The browser's cookie is the source of truth (the server's initial guess can be stale)
    setVisible(!ConsentManager.hasDecided());
    return ConsentManager.onOpenPreferences(() => {
      const current = ConsentManager.getConsent();
      setChoices(current ? { analytics: current.analytics, experiments: current.experiments, performance: current.performance } : NONE);
      setCustomizing(true);
      setVisible(true);
    });
  }, []);

  if (!visible) return null;

  // Until hydrated the buttons have no handlers: say so, so nothing (and no test) clicks a dead button
  const inert = hydrated ? undefined : true;

  const close = () => {
    setVisible(false);
    setCustomizing(false);
  };

  return (
    <section
      dir={dir}
      role="region"
      aria-labelledby="consent-banner-title"
      aria-describedby="consent-banner-description"
      data-testid="consent-banner"
      className="fixed inset-x-0 bottom-0 z-[60] p-4 sm:p-6"
    >
      <div className="mx-auto max-w-3xl rounded-lg border border-[var(--fanous-c-dialog-border)] bg-[var(--fanous-c-dialog-bg)] p-4 shadow-2xl sm:p-6">
        <h2 id="consent-banner-title" className="text-start text-base font-semibold text-[var(--fanous-c-dialog-text)]">
          {customizing ? p.preferencesTitle : p.bannerTitle}
        </h2>
        <p id="consent-banner-description" className="mt-2 text-start text-sm text-[var(--fanous-c-dialog-muted)]">
          {p.bannerDescription}{' '}
          {p.bannerChoiceHint}{' '}
          <Link href={`/${lang}/settings/privacy`} className="font-medium text-[var(--fanous-color-link)] underline hover:no-underline">
            {p.bannerSettingsLink}
          </Link>
        </p>

        {customizing && (
          <div className="mt-4">
            <ConsentPreferences value={choices} onChange={setChoices} idPrefix="consent-banner" />
          </div>
        )}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {!customizing && (
            <button
              type="button"
              onClick={() => setCustomizing(true)}
              aria-disabled={inert}
              className="b b-ghost"
            >
              {p.customize}
            </button>
          )}
          {customizing && (
            <button
              type="button"
              onClick={() => {
                ConsentManager.setConsent(choices, 'banner-custom');
                close();
              }}
              aria-disabled={inert}
              className="b b-secondary"
            >
              {p.savePreferences}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              ConsentManager.rejectAll('banner');
              close();
            }}
            aria-disabled={inert}
            className="b b-primary"
          >
            {p.rejectAll}
          </button>
          <button
            type="button"
            onClick={() => {
              ConsentManager.acceptAll('banner');
              close();
            }}
            aria-disabled={inert}
            className="b b-primary"
          >
            {p.acceptAll}
          </button>
        </div>
      </div>
    </section>
  );
}

export default ConsentBannerView;
