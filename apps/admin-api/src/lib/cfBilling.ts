/**
 * Cloudflare billed estimate (COST-GAPS): the month's al-ummah usage per billed meter, read from
 * the collector's ops_daily, turned into what Cloudflare charges after the account's included
 * usage (packages/shared-types cost-billing.ts, reconciled against the owner's invoice).
 *
 * ops_daily.cost_usd stays the list price per resource-day (drivers, movers, spikes); the budget,
 * its projection and the alerts use this billed estimate for Cloudflare.
 *
 * The account is shared with other projects, so this is Al Ummah Now's share at billed rates: the
 * invoice also carries the other projects' usage (Browser Run hours, for one, are not ours) and
 * runs on Cloudflare's billing cycle, not the calendar month used here.
 */
import { billMonth, LOG_EVENTS_PER_REQUEST, type CfBill, type CfMeterKey } from '@al-ummah/shared-types';
import { logger } from './logger';
import type { D1Database } from './types';

export type MeterUsage = Partial<Record<CfMeterKey, number>>;

interface KindDay {
  day: string;
  kind: string;
  requests: number | null;
  cpu_ms: number | null;
  reads: number | null;
  writes: number | null;
  kv_lists: number | null;
  kv_deletes: number | null;
  log_events: number | null;
  logpush_requests: number | null;
  gb_seconds: number | null;
  stored_bytes: number | null;
}

const GB = 1024 ** 3;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** Storage meters hold GB on that day; a month's GB-months are their sum over the days of the month. */
export const STORAGE_METERS: CfMeterKey[] = ['d1_storage_gb', 'r2_storage_gb', 'kv_storage_gb'];

/** One day of one kind's totals → that day's usage per meter. */
export function meterUsageOf(k: Omit<KindDay, 'day'>): MeterUsage {
  switch (k.kind) {
    case 'worker':
      return { workers_requests: num(k.requests), workers_cpu_ms: num(k.cpu_ms), logs_events: num(k.log_events), logpush_requests: num(k.logpush_requests) };
    case 'd1':
      return { d1_rows_read: num(k.reads), d1_rows_written: num(k.writes), d1_storage_gb: num(k.stored_bytes) / GB };
    case 'r2':
      return { r2_class_a: num(k.writes), r2_class_b: num(k.reads), r2_storage_gb: num(k.stored_bytes) / GB };
    case 'kv':
      return {
        kv_reads: num(k.reads),
        kv_writes: Math.max(0, num(k.writes) - num(k.kv_lists) - num(k.kv_deletes)),
        kv_lists: num(k.kv_lists),
        kv_deletes: num(k.kv_deletes),
        kv_storage_gb: num(k.stored_bytes) / GB,
      };
    case 'queue':
      // A delivered message is a write, a read and a delete
      return { queues_operations: num(k.writes) * 3 };
    case 'do':
      return { do_requests: num(k.requests), do_gb_seconds: num(k.gb_seconds), do_storage_reads: num(k.reads), do_storage_writes: num(k.writes) };
    default:
      return {};
  }
}

const addInto = (into: MeterUsage, from: MeterUsage, factor = 1) => {
  for (const [k, v] of Object.entries(from) as [CfMeterKey, number][]) into[k] = (into[k] ?? 0) + v * factor;
};

/** Per-day meter usage from ops_daily since `since` (every env: the allowances are the account's). */
export async function loadMeterDays(db: D1Database | undefined, since: string): Promise<Map<string, MeterUsage>> {
  const out = new Map<string, MeterUsage>();
  if (!db) return out;
  let rows: KindDay[] = [];
  try {
    rows =
      (
        await db
          .prepare(
            // Days collected before the billed meters existed: CPU from requests × p50, log events from requests
            `SELECT day, kind, SUM(requests) AS requests,
               SUM(COALESCE(cpu_ms, requests * cpu_p50 / 1000.0)) AS cpu_ms,
               SUM(reads) AS reads, SUM(writes) AS writes, SUM(kv_lists) AS kv_lists, SUM(kv_deletes) AS kv_deletes,
               SUM(CASE WHEN kind = 'worker' THEN COALESCE(log_events, requests * ?) END) AS log_events,
               SUM(logpush_requests) AS logpush_requests, SUM(gb_seconds) AS gb_seconds, SUM(stored_bytes) AS stored_bytes
             FROM ops_daily WHERE day >= ? GROUP BY day, kind`,
          )
          .bind(LOG_EVENTS_PER_REQUEST, since)
          .all<KindDay>()
      ).results ?? [];
  } catch (error) {
    logger.warn('[CfBilling] Meter usage unavailable', { error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    return out;
  }
  for (const r of rows) {
    const day = out.get(r.day) ?? {};
    addInto(day, meterUsageOf(r));
    out.set(r.day, day);
  }
  return out;
}

export interface CloudflareBilled {
  month: string;
  /** Month so far: usage, the invoice lines and the billed total after the included usage. */
  mtd: CfBill;
  /** End of month: the month so far plus the last 7 full days' average for the days left. */
  projected: CfBill;
  /** End of month at the month so far's daily rate (the forecast's "linear" figure). */
  linear: CfBill;
  usage: { mtd: MeterUsage; projected: MeterUsage };
}

/**
 * The idle month at billed rates: each meter at its quietest of the last 7 full days, times 30
 * (storage: the latest day's GB, a GB-month), through the same allowances as the invoice. The
 * per-resource idle figures are at list price; this is what the account would actually be billed.
 */
export function idleBilledCloudflare(days: Map<string, MeterUsage>, now: Date): number {
  const today = now.toISOString().slice(0, 10);
  const full = [...days.keys()].filter((d) => d < today).sort().slice(-7);
  if (!full.length) return 0;
  const usage: MeterUsage = {};
  const keys = new Set(full.flatMap((d) => Object.keys(days.get(d)!) as CfMeterKey[]));
  for (const k of keys) {
    usage[k] = STORAGE_METERS.includes(k) ? (days.get(full[full.length - 1]!)![k] ?? 0) : Math.min(...full.map((d) => days.get(d)![k] ?? 0)) * 30;
  }
  return billMonth(usage).total;
}

/**
 * The month's billed estimate and its projection from per-day meter usage. `coveredUntil` is how
 * far today's collected data reaches (the end of the newest hour in ops_hourly; now by default):
 * storage accrues by time, so today's size counts only for that part of the day, and a collection
 * that stopped earlier (a refused token) shows fewer GB-months, not the same.
 */
export function billedCloudflare(days: Map<string, MeterUsage>, now: Date, coveredUntil: Date = now): CloudflareBilled {
  const month = now.toISOString().slice(0, 7);
  const today = now.toISOString().slice(0, 10);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = now.getUTCDate() - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
  const daysLeft = Math.max(0, daysInMonth - daysElapsed);
  const mtd: MeterUsage = {};
  // Storage on today's row counts for the part of today the data covers (a whole day on earlier rows)
  const todayStart = Date.parse(`${today}T00:00:00Z`);
  const todayShare = Math.max(0, Math.min(1, (Math.min(coveredUntil.getTime(), now.getTime()) - todayStart) / 86_400_000));
  for (const [day, u] of days) {
    if (!day.startsWith(month)) continue;
    if (day !== today) addInto(mtd, u);
    else for (const [k, v] of Object.entries(u) as [CfMeterKey, number][]) mtd[k] = (mtd[k] ?? 0) + (STORAGE_METERS.includes(k) ? v * todayShare : v);
  }
  // The last 7 full days carried forward (the same rule as the rest of the budget's projection)
  const full = [...days.keys()].filter((d) => d < today).sort().slice(-7);
  const avg: MeterUsage = {};
  for (const d of full) addInto(avg, days.get(d)!, 1 / full.length);
  const projected: MeterUsage = { ...mtd };
  addInto(projected, avg, daysLeft);
  const linear: MeterUsage = {};
  addInto(linear, mtd, daysElapsed > 0 ? daysInMonth / daysElapsed : 1);
  // Storage: GB-days so far plus the latest size for the rest of the month (from where the data stops), over the month's days
  const latest = full.length ? days.get(full[full.length - 1]!)! : {};
  for (const k of STORAGE_METERS) {
    const sofar = mtd[k] ?? 0;
    mtd[k] = sofar / daysInMonth;
    projected[k] = (sofar + (latest[k] ?? 0) * Math.max(0, daysInMonth - (now.getUTCDate() - 1) - todayShare)) / daysInMonth;
    linear[k] = projected[k];
  }
  return { month, mtd: billMonth(mtd), projected: billMonth(projected), linear: billMonth(linear), usage: { mtd, projected } };
}
