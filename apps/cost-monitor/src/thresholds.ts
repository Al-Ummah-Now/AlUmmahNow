/**
 * Threshold alerts (docs/admin/LIVE_OPS.md §A.4). After each hourly run the
 * enabled rules in ops_thresholds are checked against ops_hourly. A crossing
 * becomes an Errors page needs-action item (key `ops:<rule>:<resource>`,
 * source 'ops') once; it is resolved when the metric recovers. Every open and
 * resolve also goes through onThresholdChange, where the admin live layer
 * publishes its `admin:ops` event.
 *
 * D1 capacity (wiki AUN-D1-SCALING, D1-1): storage_pct (size ÷ the per-database limit),
 * storage_days_to_70 (linear fit of 14 days of daily sizes), busy_pct (share of the hour spent
 * running queries, the lowest hour of the window) and account_storage_pct (every D1 database on
 * the account ÷ the account limit, kind 'd1_account'). Limits are cost_settings 'd1_limits'.
 */
import type { OpsEnv, ResourceKind } from './manifest';

export const THRESHOLD_METRICS = [
  'error_rate', 'cpu_p99', 'latency_p99', 'backlog_max', 'dlq_backlog',
  'storage_pct', 'storage_days_to_70', 'busy_pct', 'account_storage_pct',
] as const;
export type ThresholdMetric = (typeof THRESHOLD_METRICS)[number];

/** The kind of the account-wide D1 total (not a resource kind: it has no env and no row in ops_resources). */
export const ACCOUNT_KIND = 'd1_account';
export const ACCOUNT_RESOURCE_ID = 'd1_account:all';
/** Env recorded on the account total's alert (ops_alerts.env has no CHECK). */
export const ACCOUNT_ENV = 'account';

export interface D1Limits {
  /** Cloudflare D1 maximum database size (Workers Paid, developers.cloudflare.com/d1/platform/limits, 2026-11-20) */
  maxDbBytes: number;
  /** Storage per account, raisable on request */
  accountBytes: number;
}
export const DEFAULT_D1_LIMITS: D1Limits = { maxDbBytes: 10e9, accountBytes: 1e12 };
/** Days of daily sizes the forecast fits, and the fewest it needs. */
export const FORECAST_DAYS = 14;
export const FORECAST_MIN_DAYS = 7;

/** cost_settings 'd1_limits' (JSON), defaults when unset, unparsable or not positive. */
export async function loadD1Limits(db: D1Database): Promise<D1Limits> {
  try {
    const row = await db.prepare("SELECT value FROM cost_settings WHERE key = 'd1_limits'").first<{ value: string }>();
    const v = row ? (JSON.parse(row.value) as Partial<D1Limits>) : {};
    const pos = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : d);
    return { maxDbBytes: pos(v.maxDbBytes, DEFAULT_D1_LIMITS.maxDbBytes), accountBytes: pos(v.accountBytes, DEFAULT_D1_LIMITS.accountBytes) };
  } catch {
    return { ...DEFAULT_D1_LIMITS };
  }
}

export interface ThresholdRule {
  id: string;
  kind: ResourceKind | typeof ACCOUNT_KIND;
  metric: ThresholdMetric;
  op: '>' | '<';
  value: number;
  window_hours: number;
}

export interface WindowStats {
  resource_id: string;
  kind: ResourceKind | typeof ACCOUNT_KIND;
  env: OpsEnv | typeof ACCOUNT_ENV;
  name: string;
  requests: number | null;
  errors: number | null;
  cpu_p99: number | null;
  latency_p99: number | null;
  backlog_max: number | null;
  /** Largest stored size in the window (D1: databaseSizeBytes; the account total for 'd1_account') */
  stored_bytes?: number | null;
  /** Lowest hourly busy share in the window (requests × p50 query time ÷ 1 h) */
  busy_min?: number | null;
  /** Hours with a row in the window (busy_pct needs the whole window) */
  hours?: number | null;
  /** Days until 70% of the per-database limit from the 14-day trend; null without a growing trend */
  days_to_70?: number | null;
}

/** Fewer requests than this in the window and the error rate is not judged (noise). */
export const MIN_REQUESTS_FOR_ERROR_RATE = 100;

export interface ThresholdChange {
  state: 'open' | 'resolved';
  key: string;
  rule: ThresholdRule;
  resourceId: string;
  env: string;
  name: string;
  value: number | null;
}

const isDlq = (name: string) => /-dlq(-qa|-stage)?$/.test(name);

/** The rule's value for a resource over its window, or null when the rule does not apply. */
export function metricValue(rule: ThresholdRule, s: WindowStats, limits: D1Limits = DEFAULT_D1_LIMITS): number | null {
  if (s.kind !== rule.kind) return null;
  switch (rule.metric) {
    case 'storage_pct':
      return s.kind === 'd1' && typeof s.stored_bytes === 'number' ? s.stored_bytes / limits.maxDbBytes : null;
    case 'account_storage_pct':
      return s.kind === ACCOUNT_KIND && typeof s.stored_bytes === 'number' ? s.stored_bytes / limits.accountBytes : null;
    case 'storage_days_to_70':
      return s.kind === 'd1' && typeof s.days_to_70 === 'number' ? s.days_to_70 : null;
    case 'busy_pct': {
      const need = Math.min(Math.max(1, rule.window_hours || 1), 72);
      return s.kind === 'd1' && typeof s.busy_min === 'number' && (s.hours ?? 0) >= need ? s.busy_min : null;
    }
    case 'error_rate':
      if (!s.requests || s.requests < MIN_REQUESTS_FOR_ERROR_RATE) return null;
      return (s.errors ?? 0) / s.requests;
    case 'cpu_p99':
      return s.cpu_p99;
    case 'latency_p99':
      return s.latency_p99;
    case 'backlog_max':
      return isDlq(s.name) ? null : s.backlog_max;
    case 'dlq_backlog':
      return isDlq(s.name) ? s.backlog_max : null;
    default:
      return null;
  }
}

/**
 * Days until `limit × 0.7` from daily sizes (least-squares slope in bytes per day). 0 when the
 * newest size is already there; null with fewer than FORECAST_MIN_DAYS points or no growth.
 */
export function daysTo70(points: { day: string; bytes: number }[], limitBytes: number): number | null {
  const pts = points.filter((p) => Number.isFinite(p.bytes)).sort((a, b) => a.day.localeCompare(b.day));
  if (pts.length < FORECAST_MIN_DAYS) return null;
  const target = 0.7 * limitBytes;
  const latest = pts[pts.length - 1].bytes;
  if (latest >= target) return 0;
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
  const slope = den > 0 ? num / den : 0;
  if (!(slope > 0)) return null;
  return Math.round(((target - latest) / slope) * 10) / 10;
}

/**
 * Whether a value crosses its rule. The D1 capacity rules are inclusive (D1-1: "at 70%", "within 60
 * days"), so a database exactly at the line alerts; the older ops rules keep their strict compare.
 */
export function crosses(rule: ThresholdRule, value: number | null): boolean {
  if (value === null) return false;
  if (CAPACITY_METRICS.includes(rule.metric)) return rule.op === '>' ? value >= rule.value : value <= rule.value;
  return rule.op === '>' ? value > rule.value : value < rule.value;
}

export const alertKey = (ruleId: string, resourceId: string) => `ops:${ruleId}:${resourceId}`;

async function windowStats(db: D1Database, hours: number, end: Date): Promise<WindowStats[]> {
  const from = new Date(end.getTime() - hours * 3_600_000).toISOString().replace('.000Z', 'Z');
  const to = end.toISOString().replace('.000Z', 'Z');
  const { results } = await db
    .prepare(
      `SELECT resource_id, kind, env, name, SUM(requests) AS requests, SUM(errors) AS errors, MAX(cpu_p99) AS cpu_p99,
         MAX(latency_p99) AS latency_p99, MAX(backlog_max) AS backlog_max, MAX(stored_bytes) AS stored_bytes,
         MIN(CASE WHEN kind = 'd1' THEN COALESCE(requests, 0) * COALESCE(latency_p50, 0) / 3600000.0 END) AS busy_min,
         COUNT(*) AS hours
       FROM ops_hourly WHERE hour >= ? AND hour < ? GROUP BY resource_id, kind, env, name`,
    )
    .bind(from, to)
    .all<WindowStats>();
  const account = await db
    .prepare('SELECT MAX(bytes) AS bytes FROM d1_account_storage WHERE hour >= ? AND hour < ?')
    .bind(from, to)
    .first<{ bytes: number | null }>();
  const out = results ?? [];
  if (account && typeof account.bytes === 'number') {
    out.push({ resource_id: ACCOUNT_RESOURCE_ID, kind: ACCOUNT_KIND, env: ACCOUNT_ENV, name: 'all D1 databases', requests: null, errors: null, cpu_p99: null, latency_p99: null, backlog_max: null, stored_bytes: account.bytes });
  }
  return out;
}

/** days_to_70 per D1 resource from the last FORECAST_DAYS of ops_daily (indexed by env, kind, day). */
async function forecasts(db: D1Database, end: Date, limits: D1Limits): Promise<Map<string, number | null>> {
  // Exactly FORECAST_DAYS dates: the current UTC day and the 13 before it
  const since = new Date(Date.parse(`${end.toISOString().slice(0, 10)}T00:00:00Z`) - (FORECAST_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const { results } = await db
    .prepare(
      `SELECT resource_id, day, stored_bytes FROM ops_daily
       WHERE env IN ('production', 'stage', 'qa') AND kind = 'd1' AND day >= ? AND stored_bytes IS NOT NULL`,
    )
    .bind(since)
    .all<{ resource_id: string; day: string; stored_bytes: number }>();
  const by = new Map<string, { day: string; bytes: number }[]>();
  for (const r of results ?? []) {
    const list = by.get(r.resource_id) ?? [];
    list.push({ day: r.day, bytes: r.stored_bytes });
    by.set(r.resource_id, list);
  }
  return new Map([...by].map(([id, pts]) => [id, daysTo70(pts, limits.maxDbBytes)]));
}

/**
 * Checks every enabled rule; returns the alerts opened and resolved in this run.
 * `end` is the start of the current (incomplete) hour: windows end there.
 */
export async function evaluateThresholds(db: D1Database, end: Date, now: Date): Promise<ThresholdChange[]> {
  const rules = (await db.prepare('SELECT id, kind, metric, op, value, window_hours FROM ops_thresholds WHERE enabled = 1').all<ThresholdRule>()).results ?? [];
  const limits = await loadD1Limits(db);
  const forecast = rules.some((r) => r.metric === 'storage_days_to_70') ? await forecasts(db, end, limits) : new Map<string, number | null>();
  const open = new Map(
    ((await db.prepare('SELECT key, rule_id, resource_id, env FROM ops_alerts').all<{ key: string; rule_id: string; resource_id: string; env: string }>()).results ?? []).map((a) => [a.key, a]),
  );
  const changes: ThresholdChange[] = [];
  const stamp = now.toISOString();
  const statsByWindow = new Map<number, WindowStats[]>();
  const seen = new Set<string>();

  for (const rule of rules) {
    const hours = Math.min(Math.max(1, rule.window_hours || 1), 72);
    if (!statsByWindow.has(hours)) {
      const stats = await windowStats(db, hours, end);
      for (const s of stats) if (s.kind === 'd1') s.days_to_70 = forecast.get(s.resource_id) ?? null;
      statsByWindow.set(hours, stats);
    }
    for (const s of statsByWindow.get(hours)!) {
      const value = metricValue(rule, s, limits);
      if (value === null) continue;
      const key = alertKey(rule.id, s.resource_id);
      seen.add(key);
      if (crosses(rule, value)) {
        if (open.has(key)) {
          await db.prepare('UPDATE ops_alerts SET value = ?, last_seen_at = ? WHERE key = ?').bind(value, stamp, key).run();
        } else {
          await db
            .prepare('INSERT INTO ops_alerts (key, rule_id, resource_id, env, value, opened_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .bind(key, rule.id, s.resource_id, s.env, value, stamp, stamp)
            .run();
          changes.push({ state: 'open', key, rule, resourceId: s.resource_id, env: s.env, name: s.name, value });
        }
      } else if (open.has(key)) {
        await db.prepare('DELETE FROM ops_alerts WHERE key = ?').bind(key).run();
        changes.push({ state: 'resolved', key, rule, resourceId: s.resource_id, env: s.env, name: s.name, value });
      }
    }
  }
  // A rule that was disabled or deleted resolves its open alerts
  const ruleIds = new Set(rules.map((r) => r.id));
  for (const a of open.values()) {
    if (ruleIds.has(a.rule_id) || seen.has(a.key)) continue;
    await db.prepare('DELETE FROM ops_alerts WHERE key = ?').bind(a.key).run();
    const name = a.resource_id.slice(a.resource_id.indexOf(':') + 1);
    changes.push({ state: 'resolved', key: a.key, rule: { id: a.rule_id } as ThresholdRule, resourceId: a.resource_id, env: a.env, name, value: null });
  }
  return changes;
}

const METRIC_TITLE: Record<ThresholdMetric, string> = {
  error_rate: 'error rate',
  cpu_p99: 'CPU p99',
  latency_p99: 'query latency p99',
  backlog_max: 'queue backlog',
  dlq_backlog: 'dead-lettered messages',
  storage_pct: 'D1 database size',
  storage_days_to_70: 'D1 database reaches 70% of its size limit soon',
  busy_pct: 'D1 database busy',
  account_storage_pct: 'D1 storage on the account',
};

/** The D1 capacity metrics (their items link to the Costs page's Databases section). */
export const CAPACITY_METRICS: readonly ThresholdMetric[] = ['storage_pct', 'storage_days_to_70', 'busy_pct', 'account_storage_pct'];

/** Admin-facing title of an alert (the Errors page groups items by title). */
export function alertTitle(rule: ThresholdRule): string {
  if (rule.metric === 'storage_days_to_70') return `Capacity: ${METRIC_TITLE[rule.metric]}`;
  if (CAPACITY_METRICS.includes(rule.metric)) return `Capacity: ${METRIC_TITLE[rule.metric]} over threshold`;
  return `Ops: ${METRIC_TITLE[rule.metric] ?? rule.metric} over threshold`;
}

export function formatValue(rule: ThresholdRule, value: number | null): string {
  if (value === null) return 'n/a';
  if (rule.metric === 'error_rate') return `${(value * 100).toFixed(2)}%`;
  if (rule.metric === 'storage_pct' || rule.metric === 'busy_pct' || rule.metric === 'account_storage_pct') return `${(value * 100).toFixed(1)}%`;
  if (rule.metric === 'storage_days_to_70') return `${Math.round(value)} days`;
  return String(Math.round(value * 100) / 100);
}
