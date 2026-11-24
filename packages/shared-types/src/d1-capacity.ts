/**
 * D1 capacity (wiki AUN-D1-SCALING, D1-1): the limits the cost-monitor and the admin Costs page
 * judge every D1 database against, and the 14-day size forecast both use. Cloudflare limits,
 * Workers Paid (developers.cloudflare.com/d1/platform/limits, read 2026-11-24); admins can change
 * them in cost_settings 'd1_limits' without a deploy.
 */

export interface D1Limits {
  /** Maximum size of one D1 database */
  maxDbBytes: number;
  /** D1 storage per account (raisable on request) */
  accountBytes: number;
}
export const DEFAULT_D1_LIMITS: D1Limits = { maxDbBytes: 10e9, accountBytes: 1e12 };

/** Days of daily sizes the forecast fits, and the fewest it needs. */
export const FORECAST_DAYS = 14;
export const FORECAST_MIN_DAYS = 7;

/** The capacity threshold metrics (cost-monitor migration 0004). */
export const CAPACITY_METRICS = ['storage_pct', 'storage_days_to_70', 'busy_pct', 'account_storage_pct'] as const;
export type CapacityMetric = (typeof CAPACITY_METRICS)[number];
export const isCapacityMetric = (m: string): m is CapacityMetric => (CAPACITY_METRICS as readonly string[]).includes(m);

/** The account-wide total's kind and resource id in ops_thresholds / ops_alerts. */
export const D1_ACCOUNT_KIND = 'd1_account';
export const D1_ACCOUNT_RESOURCE_ID = 'd1_account:all';

/** Parses cost_settings 'd1_limits' (JSON); defaults for anything missing, unparsable or not positive. */
export function parseD1Limits(value: string | null | undefined): D1Limits {
  try {
    const v = value ? (JSON.parse(value) as Partial<D1Limits>) : {};
    const pos = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : d);
    return { maxDbBytes: pos(v.maxDbBytes, DEFAULT_D1_LIMITS.maxDbBytes), accountBytes: pos(v.accountBytes, DEFAULT_D1_LIMITS.accountBytes) };
  } catch {
    return { ...DEFAULT_D1_LIMITS };
  }
}

/** Least-squares slope of daily sizes in bytes per day; null with fewer than two days. */
export function bytesPerDay(points: { day: string; bytes: number }[]): number | null {
  const pts = points.filter((p) => Number.isFinite(p.bytes)).sort((a, b) => a.day.localeCompare(b.day));
  if (pts.length < 2) return null;
  const t0 = Date.parse(`${pts[0].day}T00:00:00Z`);
  const xs = pts.map((p) => (Date.parse(`${p.day}T00:00:00Z`) - t0) / 86_400_000);
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = pts.reduce((a, p) => a + p.bytes, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (pts[i].bytes - my);
    den += (xs[i] - mx) ** 2;
  }
  return den > 0 ? num / den : null;
}

/**
 * Days until `limitBytes × 0.7` from daily sizes. 0 when the newest size is already there; null
 * with fewer than FORECAST_MIN_DAYS points or no growth.
 */
export function daysTo70(points: { day: string; bytes: number }[], limitBytes: number): number | null {
  const pts = points.filter((p) => Number.isFinite(p.bytes)).sort((a, b) => a.day.localeCompare(b.day));
  if (pts.length < FORECAST_MIN_DAYS) return null;
  const target = 0.7 * limitBytes;
  const latest = pts[pts.length - 1].bytes;
  if (latest >= target) return 0;
  const slope = bytesPerDay(pts);
  if (slope === null || !(slope > 0)) return null;
  return Math.round(((target - latest) / slope) * 10) / 10;
}
