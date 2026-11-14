'use client';

import { useEffect } from 'react';
import { deviceClass, pageKind, RUM_SAMPLE_RATE, type RumBeacon, type RumMetric } from '@/lib/rum/vitals';

const ENDPOINT = '/api/rum';

/**
 * Field Core Web Vitals (wiki AUN-SEO phase 4, #1207; D-SEO-9: cookieless, no identifiers, no
 * consent needed). One page load in RUM_SAMPLE_RATE measures its LCP, CLS and INP (web-vitals,
 * loaded only then) and, when the page is hidden, sends one beacon: the kind of page, a device class,
 * the locale and the three values. No URL, id, storage or user agent. Renders nothing.
 */
export function WebVitalsBeacon(): null {
  useEffect(() => {
    // Automated browsers (E2E suites, Lighthouse) are not visitors: navigator.webdriver is true under
    // WebDriver/CDP automation, and the server drops headless user agents too (app/api/rum)
    if (Math.random() >= RUM_SAMPLE_RATE || typeof navigator.sendBeacon !== 'function' || navigator.webdriver) return undefined;
    const lang = document.documentElement.lang === 'ar' ? 'ar' : 'en';
    const values: Partial<Record<RumMetric, number>> = {};
    const base = { k: pageKind(window.location.pathname), d: deviceClass(window.innerWidth), l: lang } as const;
    let sent = false;
    const flush = () => {
      if (sent || Object.keys(values).length === 0) return;
      sent = true;
      const beacon: RumBeacon = { ...base, m: values };
      // A string body: text/plain, no CORS preflight, no cookies read on the server
      navigator.sendBeacon(ENDPOINT, JSON.stringify(beacon));
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    let cancelled = false;
    import('web-vitals')
      .then(({ onLCP, onCLS, onINP }) => {
        if (cancelled) return;
        const keep = (metric: { name: string; value: number }) => {
          values[metric.name as RumMetric] = metric.value;
        };
        // web-vitals reports the final values when the page is hidden; the listeners below are added
        // after its own, so they send once every metric is in
        onLCP(keep);
        onCLS(keep);
        onINP(keep);
        document.addEventListener('visibilitychange', onHidden);
        window.addEventListener('pagehide', flush);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
    };
  }, []);
  return null;
}
