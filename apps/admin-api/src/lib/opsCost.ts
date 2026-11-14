/**
 * Platform spend for the Operations page and its alerts (owner, 2026-11-14): one $500/month
 * budget for everything (Cloudflare, Bunny, Workers AI), warnings at 50% and 80% of it, a
 * projected end-of-month figure, a projected idle cost (what the platform costs with nobody on
 * it; target under $50) and an alert when daily spend or any single driver jumps.
 *
 * Sources, all estimates at list price before the account's included allowances:
 *   Cloudflare  COSTS_DB ops_daily.cost_usd (apps/cost-monitor; every env, every al-ummah resource)
 *   Bunny       SEARCH_DB delivery_cost_daily provider 'bunny', metric 'cost_usd' (api-videos collector)
 *   Containers  SEARCH_DB delivery_cost_daily provider 'r2', metric 'container_seconds' (transcodes)
 *   Workers AI  REPORTS_DB ai_usage_daily.usd
 *   Plan        the Workers Paid subscription, PLAN_BASE_USD a month whatever the usage
 * The pure functions below are what the tests cover; loaders and the alert job follow them.
 */
import { newErrorRef, scrubEvent, type ErrorEventInput } from '@al-ummah/shared-types';
import { logger } from './logger';

export const BUDGET_USD = 500;
/** Shares of the month's budget that open a warning. */
export const BUDGET_LEVELS = [0.5, 0.8, 1] as const;
/** The idle target the projected idle cost is shown against. */
export const IDLE_TARGET_USD = 50;
export const PLAN_BASE_USD = 5;
/** Containers standard-4: vCPU + GiB + GB disk per instance-second (same as api-videos media costs). */
export const CONTAINER_USD_PER_SECOND = 4 * 0.00002 + 12 * 0.0000025 + 20 * 0.00000007;
/** Days of history the idle projection and the spike baseline look at. */
export const BASELINE_DAYS = 7;
/** A jump is at least this many times the baseline day... */
export const SPIKE_FACTOR = 2;
/** ...and at least this many dollars above it (per driver; the daily total needs SPIKE_TOTAL_MIN_USD). */
export const SPIKE_MIN_USD = 0.5;
export const SPIKE_TOTAL_MIN_USD = 2;

export interface DayCost {
  day: string;
  cost: number;
}

export interface Projection {
  mtd: number;
  linear: number;
  trailing: number;
  daysElapsed: number;
  daysInMonth: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Month-end projections (cost spec §4.4): linear over the month so far, and trailing 7 full days. */
export function projectMonth(daily: DayCost[], now: Date): Projection {
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const today = now.toISOString().slice(0, 10);
  const daysElapsed = now.getUTCDate() - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440;
  const mtd = daily.filter((d) => d.day >= monthStart).reduce((s, d) => s + d.cost, 0);
  const full = daily.filter((d) => d.day < today).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 7);
  const avg = full.length ? full.reduce((s, d) => s + d.cost, 0) / full.length : 0;
  const daysLeft = Math.max(0, daysInMonth - daysElapsed);
  return {
    mtd: round2(mtd),
    linear: round2(daysElapsed > 0 ? (mtd / daysElapsed) * daysInMonth : mtd),
    trailing: round2(mtd + avg * daysLeft),
    daysElapsed: Math.round(daysElapsed * 10) / 10,
    daysInMonth,
  };
}

export type BudgetPart = 'cloudflare' | 'bunny' | 'containers' | 'ai' | 'plan';
export type BudgetLevel = 'ok' | 'warn50' | 'warn80' | 'over';

export interface BudgetStatus {
  capUsd: number;
  month: string;
  /** Spent so far this month, every source, including the plan's share of the days elapsed. */
  mtd: number;
  /** End-of-month estimate: month so far plus the trailing 7-day average for the days left. */
  projected: number;
  share: number;
  projectedShare: number;
  level: BudgetLevel;
  projectedLevel: BudgetLevel;
  parts: Record<BudgetPart, { mtd: number; projected: number }>;
  levels: readonly number[];
}

export function levelOf(share: number): BudgetLevel {
  if (share >= 1) return 'over';
  if (share >= 0.8) return 'warn80';
  if (share >= 0.5) return 'warn50';
  return 'ok';
}

/** The month's spend against the budget, per source and in total. */
export function budgetStatus(sources: Omit<Record<BudgetPart, DayCost[]>, 'plan'>, now: Date, capUsd = BUDGET_USD): BudgetStatus {
  const parts = {} as BudgetStatus['parts'];
  for (const key of ['cloudflare', 'bunny', 'containers', 'ai'] as const) {
    const p = projectMonth(sources[key], now);
    parts[key] = { mtd: p.mtd, projected: p.trailing };
  }
  const p = projectMonth([], now);
  parts.plan = { mtd: round2((PLAN_BASE_USD * p.daysElapsed) / p.daysInMonth), projected: PLAN_BASE_USD };
  const mtd = round2(Object.values(parts).reduce((s, x) => s + x.mtd, 0));
  const projected = round2(Object.values(parts).reduce((s, x) => s + x.projected, 0));
  const share = mtd / capUsd;
  const projectedShare = projected / capUsd;
  return {
    capUsd,
    month: now.toISOString().slice(0, 7),
    mtd,
    projected,
    share: Math.round(share * 1000) / 1000,
    projectedShare: Math.round(projectedShare * 1000) / 1000,
    level: levelOf(share),
    projectedLevel: levelOf(projectedShare),
    parts,
    levels: BUDGET_LEVELS,
  };
}

export interface ResourceDay {
  day: string;
  env: string;
  resource_id: string;
  name: string;
  kind: string;
  cost: number;
}

/** The last `n` full UTC days before `now`, oldest first. */
export function fullDays(now: Date, n = BASELINE_DAYS): string[] {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(today - (n - i) * 86_400_000).toISOString().slice(0, 10));
}

export interface IdleProjection {
  /** Monthly cost with nobody on the platform: each driver at its quietest day of the last 7. */
  monthlyUsd: number;
  targetUsd: number;
  byEnv: Record<string, number>;
  parts: { cloudflare: number; bunny: number; containers: number; ai: number; plan: number };
  /** The biggest idle drivers, for the page's "what keeps costing" list. */
  top: { id: string; env: string; name: string; kind: string; monthlyUsd: number }[];
  days: string[];
}

/**
 * Projected idle cost. With no real users the quietest day is the floor a resource costs (its
 * crons, polling, storage); a day without a row counts as $0, so a driver that only burst once
 * (a one-off drain, a release run) does not inflate the floor.
 */
export function idleProjection(
  rows: ResourceDay[],
  extras: { bunny: DayCost[]; containers: DayCost[]; ai: DayCost[] },
  now: Date,
): IdleProjection {
  const days = fullDays(now);
  const byResource = new Map<string, { env: string; name: string; kind: string; costs: Map<string, number> }>();
  for (const r of rows) {
    if (!days.includes(r.day)) continue;
    const e = byResource.get(r.resource_id) ?? { env: r.env, name: r.name, kind: r.kind, costs: new Map<string, number>() };
    e.costs.set(r.day, (e.costs.get(r.day) ?? 0) + num(r.cost));
    byResource.set(r.resource_id, e);
  }
  const floor = (costs: Map<string, number>) => Math.min(...days.map((d) => costs.get(d) ?? 0));
  const byEnv: Record<string, number> = {};
  const top: IdleProjection['top'] = [];
  let cloudflare = 0;
  for (const [id, e] of byResource) {
    const monthly = floor(e.costs) * 30;
    if (monthly <= 0) continue;
    cloudflare += monthly;
    byEnv[e.env] = (byEnv[e.env] ?? 0) + monthly;
    top.push({ id, env: e.env, name: e.name, kind: e.kind, monthlyUsd: round2(monthly) });
  }
  const extra = (list: DayCost[]) => floor(new Map(list.map((d) => [d.day, num(d.cost)]))) * 30;
  const parts = {
    cloudflare: round2(cloudflare),
    bunny: round2(extra(extras.bunny)),
    containers: round2(extra(extras.containers)),
    ai: round2(extra(extras.ai)),
    plan: PLAN_BASE_USD,
  };
  for (const k of Object.keys(byEnv)) byEnv[k] = round2(byEnv[k]);
  top.sort((a, b) => b.monthlyUsd - a.monthlyUsd);
  return {
    monthlyUsd: round2(Object.values(parts).reduce((s, x) => s + x, 0)),
    targetUsd: IDLE_TARGET_USD,
    byEnv,
    parts,
    top: top.slice(0, 15),
    days,
  };
}

export interface Spike {
  /** Errors page key: ops-cost:spike:<env>:<resource id | total>. */
  key: string;
  env: string;
  resourceId: string | null;
  name: string;
  day: string;
  cost: number;
  baseline: number;
}

/**
 * Daily spend jumps, per env total and per driver. A day is a jump when it costs at least
 * SPIKE_FACTOR times the average of the BASELINE_DAYS before it and at least SPIKE_MIN_USD
 * (SPIKE_TOTAL_MIN_USD for a total) more. Yesterday and today so far are both checked, so a
 * runaway loop is flagged the same day; a partial day only counts once it already crossed.
 */
export function findSpikes(rows: ResourceDay[], now: Date): Spike[] {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const series = new Map<string, { env: string; resourceId: string | null; name: string; costs: Map<string, number> }>();
  const add = (key: string, env: string, resourceId: string | null, name: string, day: string, cost: number) => {
    const s = series.get(key) ?? { env, resourceId, name, costs: new Map<string, number>() };
    s.costs.set(day, (s.costs.get(day) ?? 0) + cost);
    series.set(key, s);
  };
  for (const r of rows) {
    add(`ops-cost:spike:${r.env}:${r.resource_id}`, r.env, r.resource_id, r.name, r.day, num(r.cost));
    add(`ops-cost:spike:${r.env}:total`, r.env, null, `${r.env} total`, r.day, num(r.cost));
  }
  const out: Spike[] = [];
  for (const [key, s] of series) {
    const minUsd = s.resourceId ? SPIKE_MIN_USD : SPIKE_TOTAL_MIN_USD;
    let worst: Spike | null = null;
    for (const day of [yesterday, today]) {
      const cost = s.costs.get(day) ?? 0;
      const base = fullDays(new Date(`${day}T12:00:00Z`)).reduce((sum, d) => sum + (s.costs.get(d) ?? 0), 0) / BASELINE_DAYS;
      if (cost >= SPIKE_FACTOR * base && cost - base >= minUsd && (!worst || cost - base > worst.cost - worst.baseline)) {
        worst = { key, env: s.env, resourceId: s.resourceId, name: s.name, day, cost: round2(cost), baseline: round2(base) };
      }
    }
    if (worst) out.push(worst);
  }
  return out.sort((a, b) => b.cost - b.baseline - (a.cost - a.baseline));
}

// ---------------------------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------------------------

export interface CostDbs {
  COSTS_DB?: D1Database;
  SEARCH_DB?: D1Database;
  REPORTS_DB?: D1Database;
}

/** Each loader is best effort: a missing binding or table gives no rows, never an error page. */
async function rows<T>(db: D1Database | undefined, sql: string, ...binds: unknown[]): Promise<T[]> {
  if (!db) return [];
  try {
    return (await db.prepare(sql).bind(...binds).all<T>()).results ?? [];
  } catch (error) {
    logger.warn('[OpsCost] Cost source unavailable', { error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    return [];
  }
}

/** Cloudflare spend per resource-day. Unlike the other sources it throws (not configured / not migrated). */
export async function loadResourceDays(env: CostDbs, since: string): Promise<ResourceDay[]> {
  if (!env.COSTS_DB) return [];
  return (
    (await env.COSTS_DB.prepare('SELECT day, env, resource_id, name, kind, cost_usd AS cost FROM ops_daily WHERE day >= ? AND cost_usd > 0').bind(since).all<ResourceDay>()).results ?? []
  );
}

export async function loadExtraDays(env: CostDbs, since: string): Promise<{ bunny: DayCost[]; containers: DayCost[]; ai: DayCost[] }> {
  const [delivery, ai] = await Promise.all([
    rows<{ day: string; provider: string; metric: string; value: number }>(
      env.SEARCH_DB,
      "SELECT day, provider, metric, value FROM delivery_cost_daily WHERE day >= ? AND ((provider = 'bunny' AND metric = 'cost_usd') OR (provider = 'r2' AND metric = 'container_seconds'))",
      since,
    ),
    rows<DayCost>(env.REPORTS_DB, 'SELECT day, SUM(usd) AS cost FROM ai_usage_daily WHERE day >= ? GROUP BY day', since),
  ]);
  return {
    bunny: delivery.filter((d) => d.provider === 'bunny').map((d) => ({ day: d.day, cost: num(d.value) })),
    containers: delivery.filter((d) => d.provider === 'r2').map((d) => ({ day: d.day, cost: num(d.value) * CONTAINER_USD_PER_SECOND })),
    ai: ai.map((d) => ({ day: d.day, cost: num(d.cost) })),
  };
}

export function sumByDay(list: { day: string; cost: number }[]): DayCost[] {
  const m = new Map<string, number>();
  for (const r of list) m.set(r.day, (m.get(r.day) ?? 0) + num(r.cost));
  return [...m].map(([day, cost]) => ({ day, cost })).sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Start of the window every cost view needs: this month and 40 days back (projection, baseline, trend). */
export function costWindowStart(now: Date): string {
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const back = new Date(now.getTime() - 40 * 86_400_000).toISOString().slice(0, 10);
  return back < monthStart ? back : monthStart;
}

// ---------------------------------------------------------------------------------------------
// Alerts (admin-api hourly tick): Errors page items through the shared reporter, one per key
// ---------------------------------------------------------------------------------------------

export interface CostAlert {
  key: string;
  title: string;
  message: string;
  value: number;
}

const usd = (v: number) => `$${v.toFixed(2)}`;

/**
 * The alerts that should be open now. Budget alerts are for the account as a whole, so only the
 * production admin raises them (its collector covers every env); spikes are raised everywhere.
 */
export function wantedAlerts(budget: BudgetStatus | null, spikes: Spike[]): CostAlert[] {
  const out: CostAlert[] = [];
  if (budget) {
    for (const level of BUDGET_LEVELS) {
      if (budget.share < level) continue;
      out.push({
        key: `ops-cost:budget:${budget.month}:${Math.round(level * 100)}`,
        title: level >= 1 ? 'Monthly budget used up' : `${Math.round(level * 100)}% of the monthly budget used`,
        message: `${usd(budget.mtd)} of ${usd(budget.capUsd)} spent in ${budget.month}; projected ${usd(budget.projected)} by the end of the month`,
        value: budget.mtd,
      });
    }
    if (budget.projectedShare >= 1) {
      out.push({
        key: `ops-cost:projected:${budget.month}`,
        title: 'Projected to go over the monthly budget',
        message: `Projected ${usd(budget.projected)} for ${budget.month} against ${usd(budget.capUsd)} (${usd(budget.mtd)} so far)`,
        value: budget.projected,
      });
    }
  }
  for (const s of spikes) {
    out.push({
      key: s.key,
      title: s.resourceId ? 'Spend jump on a resource' : 'Daily spend jumped',
      message: `${s.name} (${s.env}) cost ${usd(s.cost)} on ${s.day}, against ${usd(s.baseline)} a day over the previous ${BASELINE_DAYS} days`,
      value: s.cost,
    });
  }
  return out;
}

export interface AlertSink {
  /** Opens or updates Errors page items (admin-api ingests its own items in-process). */
  report(events: ErrorEventInput[]): Promise<void>;
  resolve(keys: string[]): Promise<void>;
}

/** The in-process sink: the errors ingest queue, like lib/contact-mail-queue.ts. */
export function errorsPipelineSink(env: unknown): AlertSink {
  return {
    async report(events) {
      const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
      await ingestAndAlert(env as never, events);
    },
    async resolve(keys) {
      const { enqueueIngest } = await import('../endpoints/errors/ErrorsIngest');
      await enqueueIngest(env as never, { v: 1, events: [], resolved: keys, trustedRetry: true, receivedAt: new Date().toISOString() });
    },
  };
}

export function alertEvent(a: CostAlert, environment: string | undefined, now: Date): ErrorEventInput | null {
  return scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: a.message,
    environment,
    occurredAt: now.toISOString(),
    action: { key: a.key, source: 'ops', title: a.title, itemType: 'ops-cost', itemId: a.key, itemUrl: '/operations#spend' },
  });
}

/**
 * Opens what is newly wanted, resolves what no longer is (ops_cost_alerts keeps the open set, so
 * an alert is reported once). Budget keys carry their month, so last month's resolve on the 1st.
 */
export async function syncCostAlerts(
  env: CostDbs & { ENVIRONMENT?: string },
  sink: AlertSink,
  now = new Date(),
): Promise<{ opened: number; resolved: number }> {
  const db = env.COSTS_DB;
  if (!db) return { opened: 0, resolved: 0 };
  const since = costWindowStart(now);
  const resourceDays = await loadResourceDays(env, since);
  const budget = env.ENVIRONMENT === 'production' ? budgetStatus({ cloudflare: sumByDay(resourceDays), ...(await loadExtraDays(env, since)) }, now) : null;
  const wanted = wantedAlerts(budget, findSpikes(resourceDays, now));
  const openKeys = new Set(((await db.prepare('SELECT key FROM ops_cost_alerts').all<{ key: string }>()).results ?? []).map((o) => o.key));
  const fresh = wanted.filter((a) => !openKeys.has(a.key));
  const events = fresh.map((a) => alertEvent(a, env.ENVIRONMENT, now)).filter((e): e is ErrorEventInput => e !== null);
  if (events.length) await sink.report(events);
  const stamp = now.toISOString();
  const upsert = 'INSERT INTO ops_cost_alerts (key, value, opened_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, last_seen_at = excluded.last_seen_at';
  const wantedKeys = new Set(wanted.map((a) => a.key));
  const stale = [...openKeys].filter((k) => !wantedKeys.has(k));
  if (stale.length) await sink.resolve(stale);
  const statements = [
    ...wanted.map((a) => db.prepare(upsert).bind(a.key, a.value, stamp, stamp)),
    ...stale.map((key) => db.prepare('DELETE FROM ops_cost_alerts WHERE key = ?').bind(key)),
  ];
  if (statements.length) await db.batch(statements);
  if (fresh.length || stale.length) logger.info('[OpsCost] Spend alerts updated', { opened: fresh.length, resolved: stale.length, open: wanted.length });
  return { opened: fresh.length, resolved: stale.length };
}
