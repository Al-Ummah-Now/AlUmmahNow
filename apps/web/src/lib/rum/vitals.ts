/**
 * Field Core Web Vitals (wiki AUN-SEO phase 4, #1207), owner decision D-SEO-9: cookieless and with no
 * identifiers. A sampled share of page loads sends one beacon with that load's LCP, CLS and INP, the
 * kind of page, a device class and the locale. Nothing else: no URL, no ids, no user agent, no IP, no
 * storage. The web Worker writes each metric as one Workers Analytics Engine data point.
 */

/** Share of page loads that report (decided per load with Math.random: nothing is stored) */
export const RUM_SAMPLE_RATE = 0.05;

export const RUM_METRICS = ['LCP', 'CLS', 'INP'] as const;
export type RumMetric = (typeof RUM_METRICS)[number];

export const PAGE_KINDS = ['home', 'watch', 'short', 'channel', 'playlist', 'search', 'explore', 'feed', 'studio', 'other'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const DEVICE_CLASSES = ['phone', 'tablet', 'desktop'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export const RUM_LOCALES = ['en', 'ar'] as const;
export type RumLocale = (typeof RUM_LOCALES)[number];

/** The kind of page a path is (a template, never the path itself) */
export function pageKind(pathname: string): PageKind {
  const rest = pathname.replace(/^\/(en|ar)(?=\/|$)/, '') || '/';
  if (rest === '/') return 'home';
  if (/^\/video\/[^/]+\/?$/.test(rest)) return 'watch';
  if (/^\/shorts\/[^/]+\/?$/.test(rest)) return 'short';
  if (/^\/(channels\/[^/]+|c\/[^/]+|@[^/]+)\/?$/.test(rest)) return 'channel';
  if (/^\/playlist\/[^/]+\/?$/.test(rest)) return 'playlist';
  if (/^\/search(\/|$)/.test(rest)) return 'search';
  if (/^\/explore(\/|$)/.test(rest)) return 'explore';
  if (/^\/(feed|subscriptions)(\/|$)/.test(rest)) return 'feed';
  if (/^\/studio(\/|$)/.test(rest)) return 'studio';
  return 'other';
}

/** Viewport width buckets (the site's own breakpoints: md 768, lg 1024) */
export function deviceClass(width: number): DeviceClass {
  if (width < 768) return 'phone';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

/** Highest value kept per metric; anything above is a broken measurement */
const MAX: Record<RumMetric, number> = { LCP: 60_000, INP: 60_000, CLS: 10 };

export interface RumBeacon {
  k: PageKind;
  d: DeviceClass;
  l: RumLocale;
  m: Partial<Record<RumMetric, number>>;
}

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);

/** A beacon body checked field by field (enums, finite ranges); null when it is not one */
export function parseRumBeacon(body: unknown): RumBeacon | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!oneOf(PAGE_KINDS, b.k) || !oneOf(DEVICE_CLASSES, b.d) || !oneOf(RUM_LOCALES, b.l)) return null;
  if (!b.m || typeof b.m !== 'object') return null;
  const m: Partial<Record<RumMetric, number>> = {};
  for (const metric of RUM_METRICS) {
    const v = (b.m as Record<string, unknown>)[metric];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX[metric]) m[metric] = v;
  }
  if (Object.keys(m).length === 0) return null;
  return { k: b.k, d: b.d, l: b.l, m };
}
