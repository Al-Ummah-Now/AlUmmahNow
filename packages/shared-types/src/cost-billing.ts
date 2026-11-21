/**
 * Cloudflare billing model (COST-GAPS): list prices and the account's monthly included usage per
 * billed meter, and how Cloudflare turns usage into an invoice line.
 *
 * Checked against the owner's Cloudflare invoice for 2026-10-23 → 2026-11-21 ($262.51): every line
 * is ceil((usage − included) / unit) × price, so a meter is billed in whole units (a million
 * requests, a GB-month) once it is past its allowance. KV writes at 621.13K billable were $5.00
 * (one whole million), R2 Class A at 5.62M billable was $27.00 (six millions). The allowances
 * apply once per account and month, while the collector prices each resource-day at list price
 * (ops_daily.cost_usd), so admin-api applies them here to the month's totals.
 *
 * The account is shared with other projects: these meters only ever see al-ummah usage, so the
 * billed estimate is Al Ummah Now's share at billed rates, not the whole invoice.
 */

export interface CfMeter {
  /** Included per month on Workers Paid (in the meter's own unit: requests, ms, GB-months…). */
  included: number;
  /** Billing step: the price is per this many units, and billable usage is rounded up to whole steps. */
  unit: number;
  /** USD per `unit`. */
  price: number;
  /** false: listed by Cloudflare but not billed today (Analytics Engine). */
  billed?: boolean;
  /** What the collector measures it from; 'none' = no al-ummah usage source (shown, never estimated). */
  source: 'measured' | 'estimated' | 'none';
}

/** Workers Paid, 2026-11. */
export const CF_METERS = {
  workers_requests: { included: 10e6, unit: 1e6, price: 0.3, source: 'measured' },
  workers_cpu_ms: { included: 30e6, unit: 1e6, price: 0.02, source: 'measured' },
  /** Workers Logs events: one per logged invocation plus one per console line (estimated, see LOG_EVENTS_PER_REQUEST). */
  logs_events: { included: 20e6, unit: 1e6, price: 0.6, source: 'estimated' },
  /** Requests of Workers with logpush: true (Workers Trace Events Logpush). */
  logpush_requests: { included: 10e6, unit: 1e6, price: 0.05, source: 'measured' },
  d1_rows_read: { included: 25e9, unit: 1e6, price: 0.001, source: 'measured' },
  d1_rows_written: { included: 50e6, unit: 1e6, price: 1, source: 'measured' },
  d1_storage_gb: { included: 5, unit: 1, price: 0.75, source: 'measured' },
  r2_class_a: { included: 1e6, unit: 1e6, price: 4.5, source: 'measured' },
  r2_class_b: { included: 10e6, unit: 1e6, price: 0.36, source: 'measured' },
  r2_storage_gb: { included: 10, unit: 1, price: 0.015, source: 'measured' },
  kv_reads: { included: 10e6, unit: 1e6, price: 0.5, source: 'measured' },
  kv_writes: { included: 1e6, unit: 1e6, price: 5, source: 'measured' },
  kv_deletes: { included: 1e6, unit: 1e6, price: 5, source: 'measured' },
  kv_lists: { included: 1e6, unit: 1e6, price: 5, source: 'measured' },
  kv_storage_gb: { included: 1, unit: 1, price: 0.5, source: 'measured' },
  queues_operations: { included: 1e6, unit: 1e6, price: 0.4, source: 'measured' },
  do_requests: { included: 1e6, unit: 1e6, price: 0.15, source: 'measured' },
  do_gb_seconds: { included: 400e3, unit: 1e6, price: 12.5, source: 'measured' },
  do_storage_reads: { included: 1e6, unit: 1e6, price: 0.2, source: 'measured' },
  do_storage_writes: { included: 1e6, unit: 1e6, price: 1, source: 'measured' },
  /** Browser Run: no al-ummah Worker binds it (the invoice's hours belong to another project on the account). */
  browser_hours: { included: 10, unit: 1, price: 0.09, source: 'none' },
  /** Workers Analytics Engine (RUM, abuse and auth event datasets): "you will not be billed" today. */
  analytics_engine_writes: { included: 10e6, unit: 1e6, price: 0.25, billed: false, source: 'none' },
  /** Images binding transformations (apps/web): no analytics source; the first 5,000 a month are free. */
  images_transformations: { included: 5000, unit: 1000, price: 0.5, source: 'none' },
} as const satisfies Record<string, CfMeter>;

export type CfMeterKey = keyof typeof CF_METERS;
export const CF_METER_KEYS = Object.keys(CF_METERS) as CfMeterKey[];

/**
 * Workers Logs events per logged request: an invocation log plus the console lines it writes.
 * Calibrated on the 2026-10-23 → 11-21 invoice (102.75M events for 60.73M Workers requests).
 */
export const LOG_EVENTS_PER_REQUEST = 1.7;

export interface CfBillLine {
  key: CfMeterKey;
  used: number;
  included: number;
  /** Usage past the allowance, before rounding up to whole units. */
  billable: number;
  /** What Cloudflare charges for it (0 for a meter it does not bill). */
  cost: number;
  /** used / unit × price: the same usage at list price, no allowance, no rounding. */
  listCost: number;
}

export interface CfBill {
  lines: CfBillLine[];
  /** Billed estimate after the included usage, in USD. */
  total: number;
  /** The same usage at list price. */
  listTotal: number;
}

const cents = (v: number) => Math.round(v * 100) / 100;

/** One meter's invoice line for a month of usage. */
export function billLine(key: CfMeterKey, used: number): CfBillLine {
  const m: CfMeter = CF_METERS[key];
  const u = Number.isFinite(used) && used > 0 ? used : 0;
  const billable = Math.max(0, u - m.included);
  // Whole units, with a hair of slack so 60.000000001M (float noise) is not billed as 61
  const units = billable > 0 ? Math.ceil(billable / m.unit - 1e-9) : 0;
  const active = m.billed !== false;
  return { key, used: u, included: m.included, billable, cost: active ? cents(units * m.price) : 0, listCost: active ? Math.round((u / m.unit) * m.price * 1e6) / 1e6 : 0 };
}

/** The month's Cloudflare bill for this usage: every meter past its allowance, in whole units. */
export function billMonth(usage: Partial<Record<CfMeterKey, number>>): CfBill {
  const lines = CF_METER_KEYS.map((k) => billLine(k, usage[k] ?? 0));
  return { lines, total: cents(lines.reduce((s, l) => s + l.cost, 0)), listTotal: cents(lines.reduce((s, l) => s + l.listCost, 0)) };
}
