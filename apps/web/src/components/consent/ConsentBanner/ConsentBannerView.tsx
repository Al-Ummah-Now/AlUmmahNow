'use client';

/**
 * Shared consent banner implementation for the LTR and RTL variants.
 *
 * GDPR / ePrivacy requirements implemented here:
 * - Shown until the user decides; nothing optional runs before that (default deny).
 * - "Reject all" is as prominent and as easy as "Accept all" (one click each).
 * - Granular per-category choices, reachable from the banner.
 * - Reopenable later (ConsentManager.openPreferences) to change or withdraw consent.
 */

import React, { useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { useLanguage } from '@/hooks/useLanguage';
import { ConsentManager, type ConsentChoices } from '@/lib/consent/ConsentManager';
import { ConsentPreferences } from '../ConsentPreferences';

export interface ConsentBannerViewProps {
  dir: 'ltr' | 'rtl';
}

const NONE: ConsentChoices = { analytics: false, experiments: false, performance: false };

export function ConsentBannerView({ dir }: ConsentBannerViewProps) {
  const { t, lang } = useLanguage();
  const p = t.privacy;
  const [visible, setVisible] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [choices, setChoices] = useState<ConsentChoices>(NONE);

  useEffect(() => {
    // The decision lives in a cookie, so only decide visibility on the client.
    setVisible(!ConsentManager.hasDecided());
    return ConsentManager.onOpenPreferences(() => {
      const current = ConsentManager.getConsent();
      setChoices(current ? { analytics: current.analytics, experiments: current.experiments, performance: current.performance } : NONE);
      setCustomizing(true);
      setVisible(true);
    });
  }, []);

  if (!visible) return null;

  const close = () => {
    setVisible(false);
    setCustomizing(false);
  };

  return (
    <div
      dir={dir}
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-banner-title"
      aria-describedby="consent-banner-description"
      data-testid="consent-banner"
      className="fixed inset-x-0 bottom-0 z-[60] p-4 sm:p-6"
    >
      <div className="mx-auto max-w-3xl rounded-lg border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-800 sm:p-6">
        <h2 id="consent-banner-title" className="text-start text-base font-semibold text-gray-900 dark:text-gray-100">
          {customizing ? p.preferencesTitle : p.bannerTitle}
        </h2>
        <p id="consent-banner-description" className="mt-2 text-start text-sm text-gray-600 dark:text-gray-300">
          {p.bannerDescription}{' '}
          {p.bannerChoiceHint}{' '}
          <Link href={`/${lang}/settings/privacy`} className="font-medium text-blue-700 underline hover:no-underline dark:text-blue-300">
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
              className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 underline-offset-2 hover:underline dark:text-gray-200"
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
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
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
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            {p.rejectAll}
          </button>
          <button
            type="button"
            onClick={() => {
              ConsentManager.acceptAll('banner');
              close();
            }}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            {p.acceptAll}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConsentBannerView;
