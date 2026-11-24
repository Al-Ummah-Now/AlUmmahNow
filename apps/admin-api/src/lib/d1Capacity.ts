/**
 * D1 capacity for the admin Costs page's Databases section, the Operations and Status gauges and
 * the capacity emails (wiki AUN-D1-SCALING, D1-1). Reads only what the cost-monitor collected
 * (COSTS_DB: ops_daily, ops_hourly, d1_account_storage, ops_thresholds, ops_alerts); every query is
 * on an index or a primary key, never a scan of another database.
 */
import {
  CAPACITY_METRICS,
  D1_ACCOUNT_RESOURCE_ID,
  FORECAST_DAYS,
  bytesPerDay,
  daysTo70,
  isCapacityMetric,
  parseD1Limits,
  type CapacityMetric,
  type D1Limits,
} from '@al-ummah/shared-types';
import { logger } from './logger';
import type { D1Database } from './types';
import { queueCostEmails } from './cost-alert-mail';

const ENVS = "('production', 'stage', 'qa')";
const CAPACITY_IN = CAPACITY_METRICS.map((m) => `'${m}'`).join(', ');

/**
 * Every query of this module, exported so a test can assert each plan seeks an index or a primary
 * key (cost-monitor migration 0005 adds the ones they need).
 */
export const CAPACITY_SQL = {
  daily: `SELECT resource_id, env, name, day, stored_bytes, writes FROM ops_daily WHERE env IN ${ENVS} AND kind = 'd1' AND day >= ? AND day <= ? ORDER BY day`,
  busy: `SELECT resource_id, MAX(COALESCE(requests, 0) * COALESCE(latency_p50, 0) / 3600000.0) AS peak
         FROM ops_hourly WHERE env IN ${ENVS} AND kind = 'd1' AND hour >= ? AND hour < ? GROUP BY resource_id`,
  rules: `SELECT id, kind, metric, op, value, window_hours, enabled, updated_by, updated_at FROM ops_thresholds WHERE metric IN (${CAPACITY_IN}) ORDER BY id`,
  alerts: `SELECT a.rule_id, a.resource_id FROM ops_thresholds t JOIN ops_alerts a ON a.rule_id = t.id WHERE t.metric IN (${CAPACITY_IN})`,
  account: 'SELECT hour, bytes, databases FROM d1_account_storage ORDER BY hour DESC LIMIT 1',
  emails: `SELECT a.key, a.env, a.resource_id, a.value, a.opened_at, t.metric, t.value AS threshold
       FROM ops_thresholds t JOIN ops_alerts a ON a.rule_id = t.id WHERE t.metric IN (${CAPACITY_IN})`,
} as const;

const DAY_MS = 86_400_000;
/** 'YYYY-MM-DD' of the UTC day `n` days before `now`'s. */
const dayBefore = (now: Date, n: number) => new Date(Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);
/** Days the rows-written average and the peak busy share look back. */
export const ACTIVITY_DAYS = 7;

export interface D1DatabaseRow {
  id: string;
  env: string;
  name: string;
  /** Newest daily size */
  bytes: number | null;
  /** bytes ÷ the per-database limit */
  share: number | null;
  /** 14-day trend, bytes per day (null with fewer than two days) */
  growthPerDay: number | null;
  /** Days until 70% of the limit (0 = already there; null = not growing or too little history) */
  daysTo70: number | null;
  /** Average rows written per day over the last ACTIVITY_DAYS days */
  rowsWrittenPerDay: number | null;
  /** Highest hourly share of time spent running queries over the last ACTIVITY_DAYS days */
  peakBusy: number | null;
  /** Open capacity alerts on this database (rule ids) */
  alerts: string[];
}

export interface CapacityRule {
  id: string;
  kind: string;
  metric: CapacityMetric;
  op: '>' | '<';
  value: number;
  window_hours: number;
  enabled: number;
  updated_by: string | null;
  updated_at: string;
}

export interface DatabasesOverview {
  limits: D1Limits;
  databases: D1DatabaseRow[];
  account: { bytes: number; databases: number; share: number; hour: string; alerts: string[] } | null;
  rules: CapacityRule[];
}

const round = (n: number | null, d = 1) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

export async function loadD1Limits(db: D1Database): Promise<D1Limits> {
  const row = await db.prepare("SELECT value FROM cost_settings WHERE key = 'd1_limits'").first<{ value: string }>().catch(() => null);
  return parseD1Limits(row?.value);
}

/** Every D1 database the cost-monitor sees, sorted by days to 70% (soonest first), then by size. */
export async function databasesOverview(db: D1Database, now = new Date()): Promise<DatabasesOverview> {
  const limits = await loadD1Limits(db);
  // Exact windows: the forecast fits FORECAST_DAYS dates (today and the 13 before it); rows written
  // average the ACTIVITY_DAYS complete days before today (a day with no row counts as 0); peak busy
  // looks at the ACTIVITY_DAYS × 24 complete hours before this one.
  const today = dayBefore(now, 0);
  const since = dayBefore(now, FORECAST_DAYS - 1);
  const activityFirst = dayBefore(now, ACTIVITY_DAYS);
  const activityLast = dayBefore(now, 1);
  const hourNow = new Date(now);
  hourNow.setUTCMinutes(0, 0, 0);
  const hourIso = (d: Date) => d.toISOString().replace('.000Z', 'Z');
  const activityHourFrom = hourIso(new Date(hourNow.getTime() - ACTIVITY_DAYS * 24 * 3_600_000));
  const activityHourTo = hourIso(hourNow);

  const [daily, busy, rulesRes, alertsRes, account] = await Promise.all([
    db
      .prepare(CAPACITY_SQL.daily)
      .bind(dayBefore(now, Math.max(FORECAST_DAYS - 1, ACTIVITY_DAYS)), today)
      .all<{ resource_id: string; env: string; name: string; day: string; stored_bytes: number | null; writes: number | null }>(),
    db
      .prepare(CAPACITY_SQL.busy)
      .bind(activityHourFrom, activityHourTo)
      .all<{ resource_id: string; peak: number | null }>(),
    db.prepare(CAPACITY_SQL.rules).all<CapacityRule>(),
    db.prepare(CAPACITY_SQL.alerts).all<{ rule_id: string; resource_id: string }>(),
    db
      .prepare(CAPACITY_SQL.account)
      .first<{ hour: string; bytes: number; databases: number }>()
      .catch((error) => {
        // Before cost-monitor migration 0004 the table does not exist yet
        logger.debug('[D1Capacity] No account total yet', { error: String(error) });
        return null;
      }),
  ]);

  const rules = (rulesRes.results ?? []).filter((r) => isCapacityMetric(r.metric));
  const capacityRuleIds = new Set(rules.map((r) => r.id));
  const alertsBy = new Map<string, string[]>();
  for (const a of alertsRes.results ?? []) {
    if (!capacityRuleIds.has(a.rule_id)) continue;
    alertsBy.set(a.resource_id, [...(alertsBy.get(a.resource_id) ?? []), a.rule_id]);
  }
  const peakBy = new Map((busy.results ?? []).map((b) => [b.resource_id, b.peak]));

  const byId = new Map<string, { env: string; name: string; points: { day: string; bytes: number }[]; writes: number[] }>();
  for (const r of daily.results ?? []) {
    const e = byId.get(r.resource_id) ?? { env: r.env, name: r.name, points: [], writes: [] };
    if (r.day >= since && typeof r.stored_bytes === 'number') e.points.push({ day: r.day, bytes: r.stored_bytes });
    if (r.day >= activityFirst && r.day <= activityLast && typeof r.writes === 'number') e.writes.push(r.writes);
    byId.set(r.resource_id, e);
  }

  const databases: D1DatabaseRow[] = [...byId].map(([id, e]) => {
    const latest = e.points.length ? e.points[e.points.length - 1].bytes : null;
    return {
      id,
      env: e.env,
      name: e.name,
      bytes: latest,
      share: latest === null ? null : round(latest / limits.maxDbBytes, 4),
      growthPerDay: round(bytesPerDay(e.points), 0),
      daysTo70: daysTo70(e.points, limits.maxDbBytes),
      // Over all ACTIVITY_DAYS days, a missing day as 0; null only when none of them has a row
      rowsWrittenPerDay: e.writes.length ? Math.round(e.writes.reduce((a, b) => a + b, 0) / ACTIVITY_DAYS) : null,
      peakBusy: round(peakBy.get(id) ?? null, 4),
      alerts: alertsBy.get(id) ?? [],
    };
  });
  const soon = (d: D1DatabaseRow) => (d.daysTo70 === null ? Infinity : d.daysTo70);
  databases.sort((a, b) => soon(a) - soon(b) || (b.bytes ?? 0) - (a.bytes ?? 0) || a.name.localeCompare(b.name));

  return {
    limits,
    databases,
    account: account
      ? { bytes: account.bytes, databases: account.databases, share: round(account.bytes / limits.accountBytes, 4) ?? 0, hour: account.hour, alerts: alertsBy.get(D1_ACCOUNT_RESOURCE_ID) ?? [] }
      : null,
    rules,
  };
}

export interface D1LimitsInput {
  maxDbBytes: number;
  accountBytes: number;
}

/** Validates the limits form: whole GB per database (1–1,000) and whole GB per account (1–100,000). */
export function parseD1LimitsInput(body: unknown): D1LimitsInput | string {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  // Whole GB only: 1.5 is refused, not rounded
  const gb = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null);
  const db = gb(b.maxDbGb, 1_000);
  const acct = gb(b.accountGb, 100_000);
  if (db === null) return 'maxDbGb must be 1–1000';
  if (acct === null) return 'accountGb must be 1–100000';
  return { maxDbBytes: db * 1e9, accountBytes: acct * 1e9 };
}

export interface CapacityMailPayload {
  type: 'capacity';
  metric: CapacityMetric;
  env: string;
  name: string;
  value: number | null;
  threshold: number;
}

/**
 * The capacity emails (subscription kind 'capacity'): one per open capacity alert per admin who
 * opted in. The fingerprint is the alert key and the time it opened, so an alert that resolves and
 * opens again emails again, and queueCostEmails never sends the same one twice.
 */
export async function queueCapacityEmails(env: Parameters<typeof queueCostEmails>[0] & { COSTS_DB?: D1Database }, now = new Date()): Promise<number> {
  const db = env.COSTS_DB;
  if (!db) return 0;
  const { results } = await db
    .prepare(CAPACITY_SQL.emails)
    .all<{ key: string; env: string; resource_id: string; value: number | null; opened_at: string; metric: CapacityMetric; threshold: number }>();
  let queued = 0;
  for (const a of results ?? []) {
    const payload: CapacityMailPayload = {
      type: 'capacity',
      metric: a.metric,
      env: a.env,
      name: a.resource_id === D1_ACCOUNT_RESOURCE_ID ? '' : a.resource_id.slice(a.resource_id.indexOf(':') + 1),
      value: a.value,
      threshold: a.threshold,
    };
    queued += await queueCostEmails(env, 'capacity', `${a.key}@${a.opened_at}`.slice(0, 200), payload, now);
  }
  return queued;
}
