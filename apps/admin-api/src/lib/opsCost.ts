/**
 * Platform spend for the Operations page and its alerts (owner, 2026-11-14): one admin-configured monthly
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
import { accruedMonthCents, centsByDay, COST_ALERT_DEFAULTS, dayElapsed, newErrorRef, parseCostAlertSettings, scrubEvent, type CostAlertSettings, type ErrorEventInput } from '@al-ummah/shared-types';
import { logger } from './logger';
import type { D1Database } from './types';

/** The idle target the projected idle cost is shown against. */
export const IDLE_TARGET_USD = 50;
export const PLAN_BASE_USD = 5;

/** The plan's month to date: its fee spread per UTC day, each day at the cent, as the daily chart draws it. */
export function planMtd(now: Date): number {
  return accruedMonthCents((day) => PLAN_BASE_USD / new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate(), now) / 100;
}
/** Containers standard-4: vCPU + GiB + GB disk per instance-second (same as api-videos media costs). */
export const CONTAINER_USD_PER_SECOND = 4 * 0.00002 + 12 * 0.0000025 + 20 * 0.00000007;
/** Days of history the idle projection and the spike baseline look at. */
export const BASELINE_DAYS = 7;

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

export type BudgetPart = 'cloudflare' | 'bunny' | 'containers' | 'ai' | 'resend' | 'plan' | 'fixed';
export type BudgetLevel = 'ok' | 'warn50' | 'warn80' | 'over';

export interface BudgetStatus {
  capUsd: number | null;
  month: string;
  /** Spent so far this month, every source, including the plan's share of the days elapsed. */
  mtd: number;
  /** End-of-month estimate: month so far plus the trailing 7-day average for the days left. */
  projected: number;
  share: number | null;
  projectedShare: number | null;
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
export function budgetStatus(
  sources: Omit<Record<BudgetPart, DayCost[]>, 'plan' | 'resend' | 'fixed'> & { resend?: DayCost[] },
  now: Date,
  /** The admin-set budget (loadCostSettings); null until a super admin sets one (#1427). */
  capUsd: number | null = COST_ALERT_DEFAULTS.budgetUsd,
  /** The alert levels set in Costs → Alert settings; the meter draws its marks at these shares. */
  levels: readonly number[] = COST_ALERT_DEFAULTS.budgetLevels,
  /**
   * COST-GAPS: Cloudflare as billed (after the account's included usage, lib/cfBilling.ts) in place
   * of the list-price days, and the fixed and other costs from the Costs page.
   */
  overrides: { cloudflare?: { mtd: number; projected: number }; fixed?: { mtd: number; projected: number } } = {},
): BudgetStatus {
  const parts = {} as BudgetStatus['parts'];
  for (const key of ['cloudflare', 'bunny', 'containers', 'ai', 'resend'] as const) {
    const p = projectMonth(sources[key] ?? [], now);
    parts[key] = { mtd: p.mtd, projected: p.trailing };
  }
  if (overrides.cloudflare) parts.cloudflare = { mtd: round2(overrides.cloudflare.mtd), projected: round2(overrides.cloudflare.projected) };
  parts.fixed = { mtd: round2(overrides.fixed?.mtd ?? 0), projected: round2(overrides.fixed?.projected ?? 0) };
  parts.plan = { mtd: planMtd(now), projected: PLAN_BASE_USD };
  const mtd = round2(Object.values(parts).reduce((s, x) => s + x.mtd, 0));
  const projected = round2(Object.values(parts).reduce((s, x) => s + x.projected, 0));
  const hasCap = capUsd !== null && Number.isFinite(capUsd) && capUsd > 0;
  const share = hasCap ? mtd / capUsd : null;
  const projectedShare = hasCap ? projected / capUsd : null;
  return {
    capUsd: hasCap ? capUsd : null,
    month: now.toISOString().slice(0, 7),
    mtd,
    projected,
    // Enough precision for the page to show two decimals of a percent (24.92%, not 24.9 padded)
    share: share === null ? null : Math.round(share * 1e6) / 1e6,
    projectedShare: projectedShare === null ? null : Math.round(projectedShare * 1e6) / 1e6,
    level: share === null ? 'ok' : levelOf(share),
    projectedLevel: projectedShare === null ? 'ok' : levelOf(projectedShare),
    parts,
    levels: [...levels].sort((a, b) => a - b),
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
  parts: { cloudflare: number; bunny: number; containers: number; ai: number; plan: number; fixed: number };
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
  /** Fixed and other costs a month: paid whether anyone uses the platform or not. */
  fixedMonthly = 0,
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
    fixed: round2(fixedMonthly),
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

/**
 * The idle month with Cloudflare at billed rates (cfBilling idleBilledCloudflare): the per-resource
 * floors are list prices, so the account's included usage would otherwise be counted as cost and
 * the idle month could exceed the projected one. The per-env split keeps its list-price shares.
 */
/** Splits `totalCents` over `weights` by largest remainder: whole cents that add up exactly. */
export function apportionCents(totalCents: number, weights: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const sum = [...weights.values()].reduce((a, b) => a + Math.max(0, b), 0);
  if (weights.size === 0) return out;
  if (sum <= 0) {
    // Nothing to weigh by: an even split, any leftover cent to the first
    const keys = [...weights.keys()];
    keys.forEach((k, i) => out.set(k, Math.floor(totalCents / keys.length) + (i < totalCents % keys.length ? 1 : 0)));
    return out;
  }
  const exact = [...weights].map(([k, w]) => ({ k, v: (Math.max(0, w) / sum) * totalCents }));
  for (const e of exact) out.set(e.k, Math.floor(e.v));
  let left = totalCents - [...out.values()].reduce((a, b) => a + b, 0);
  for (const e of [...exact].sort((a, b) => b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)) || b.v - a.v)) {
    if (left <= 0) break;
    out.set(e.k, out.get(e.k)! + 1);
    left--;
  }
  return out;
}

export function billIdle(idle: IdleProjection, cloudflareBilled: number): IdleProjection {
  const listCf = idle.parts.cloudflare;
  const ratio = listCf > 0 ? cloudflareBilled / listCf : 0;
  // The environments split the rounded Cloudflare part in cents (largest remainder), so they add up to it exactly
  const cloudflare = round2(cloudflareBilled);
  const cents = ratio > 0 ? apportionCents(Math.round(cloudflare * 100), new Map(Object.entries(idle.byEnv))) : new Map<string, number>();
  const byEnv: Record<string, number> = {};
  for (const k of Object.keys(idle.byEnv)) byEnv[k] = (cents.get(k) ?? 0) / 100;
  const parts = { ...idle.parts, cloudflare };
  return { ...idle, byEnv, parts, monthlyUsd: round2(Object.values(parts).reduce((s, x) => s + x, 0)) };
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
 * spikeFactor times the average of the BASELINE_DAYS before it and at least spikeMinUsd
 * (spikeTotalMinUsd for a total) more, all from the saved alert settings. Yesterday and today so far are both checked, so a
 * runaway loop is flagged the same day; a partial day only counts once it already crossed.
 */
export interface SpikeRule {
  factor: number;
  minUsd: number;
  totalMinUsd: number;
}

export const DEFAULT_SPIKE_RULE: SpikeRule = { factor: COST_ALERT_DEFAULTS.spikeFactor, minUsd: COST_ALERT_DEFAULTS.spikeMinUsd, totalMinUsd: COST_ALERT_DEFAULTS.spikeTotalMinUsd };

export const spikeRuleOf = (s: CostAlertSettings): SpikeRule => ({ factor: s.spikeFactor, minUsd: s.spikeMinUsd, totalMinUsd: s.spikeTotalMinUsd });

export function findSpikes(rows: ResourceDay[], now: Date, rule: SpikeRule = DEFAULT_SPIKE_RULE): Spike[] {
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
    const minUsd = s.resourceId ? rule.minUsd : rule.totalMinUsd;
    let worst: Spike | null = null;
    for (const day of [yesterday, today]) {
      const cost = s.costs.get(day) ?? 0;
      const base = fullDays(new Date(`${day}T12:00:00Z`)).reduce((sum, d) => sum + (s.costs.get(d) ?? 0), 0) / BASELINE_DAYS;
      if (cost >= rule.factor * base && cost - base >= minUsd && (!worst || cost - base > worst.cost - worst.baseline)) {
        worst = { key, env: s.env, resourceId: s.resourceId, name: s.name, day, cost: round2(cost), baseline: round2(base) };
      }
    }
    if (worst) out.push(worst);
  }
  return out.sort((a, b) => b.cost - b.baseline - (a.cost - a.baseline));
}

// ---------------------------------------------------------------------------------------------
// Spend views (moved from the Operations page to the Costs page, owner 2026-11-21)
// ---------------------------------------------------------------------------------------------

export const COST_TREND_KEYS = ['production', 'stage', 'qa', 'bunny', 'containers', 'ai', 'resend', 'plan', 'fixed'] as const;
export type CostTrendKey = (typeof COST_TREND_KEYS)[number];

/**
 * Daily spend for the last 30 days, one series per env (Cloudflare at list price) and per other
 * source. Fixed costs are their month's share spread over the month's days.
 */
/** UTC days the trend carries before today (the page shows 30 local days). */
export const TREND_DAYS = 30;

export function trendBySource(
  resourceDays: ResourceDay[],
  extras: { bunny: DayCost[]; containers: DayCost[]; ai: DayCost[]; resend: DayCost[] },
  fixedDaily: (day: string) => number,
  now: Date,
  /** This month's environment days as the page shows them, in cents (costs.ts resourceDayCents); other days from the raw rows. */
  envDayCents?: Map<string, Map<string, number>>,
): { days: string[]; series: { key: CostTrendKey; values: number[] }[] } {
  // 30 UTC days to today, plus the one before: the page draws the last 30 days on the viewer's
  // calendar, and in the Americas' evening its window starts a UTC day earlier (admin-web localTrend)
  const days = [...fullDays(now, TREND_DAYS), now.toISOString().slice(0, 10)];
  const perEnv = new Map<string, Map<string, number>>();
  for (const r of resourceDays) {
    const m = perEnv.get(r.env) ?? new Map<string, number>();
    m.set(r.day, (m.get(r.day) ?? 0) + num(r.cost));
    perEnv.set(r.env, m);
  }
  const series = (m: Map<string, number> | undefined) => days.map((d) => round2(m?.get(d) ?? 0));
  const fromList = (list: DayCost[]) => new Map(list.map((x) => [x.day, num(x.cost)]));
  // Monthly fees accrue by the minute, like the month to date: today carries only its elapsed part,
  // so a month's days sum to its month-to-date figure
  const today = days[days.length - 1]!;
  // The cells the plan's and the fixed costs' month to date sum (accruedMonthCents): per day without
  // drift, today for its elapsed part
  const accrued = (perDay: (d: string) => number) => {
    const cells = centsByDay(days.map((d) => [d, perDay(d) * dayElapsed(d, now)] as const));
    return days.map((d) => (cells.get(d) ?? 0) / 100);
  };
  const daysIn = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
  return {
    days,
    series: [
      ...(['production', 'stage', 'qa'] as const).map((e) => {
        const shown = envDayCents?.get(e);
        return { key: e, values: series(perEnv.get(e)).map((v, i) => (envDayCents && days[i]!.startsWith(today.slice(0, 7)) ? (shown?.get(days[i]!) ?? 0) / 100 : v)) };
      }),
      { key: 'bunny' as const, values: series(fromList(extras.bunny)) },
      { key: 'containers' as const, values: series(fromList(extras.containers)) },
      { key: 'ai' as const, values: series(fromList(extras.ai)) },
      { key: 'resend' as const, values: series(fromList(extras.resend)) },
      { key: 'plan' as const, values: accrued((d) => PLAN_BASE_USD / daysIn(d)) },
      { key: 'fixed' as const, values: accrued(fixedDaily) },
    ],
  };
}

/** Top drivers listed on the Costs page (by month-to-date cost). */
export const COST_DRIVERS = 25;

export interface CostDriver {
  id: string;
  env: string;
  kind: string;
  name: string;
  mtdUsd: number;
  idleMonthlyUsd: number;
  spike: Spike | null;
  daily: { days: string[]; values: number[] };
}

/** Each resource's month-to-date list cost, its 14-day daily cost, its idle floor and any open jump. */
export function costDrivers(resourceDays: ResourceDay[], idle: IdleProjection, spikes: Spike[], now: Date, shown?: Map<string, { usd: number }>): CostDriver[] {
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  // The last 14 full days: exactly the two weeks Top movers compares (fullDays(now, 7) and the 7 before)
  const sparkDays = fullDays(now, 14);
  const drivers = new Map<string, { id: string; env: string; kind: string; name: string; mtd: number; byDay: Map<string, number> }>();
  for (const r of resourceDays) {
    const d = drivers.get(r.resource_id) ?? { id: r.resource_id, env: r.env, kind: r.kind, name: r.name, mtd: 0, byDay: new Map<string, number>() };
    if (r.day >= monthStart) d.mtd += num(r.cost);
    d.byDay.set(r.day, (d.byDay.get(r.day) ?? 0) + num(r.cost));
    drivers.set(r.resource_id, d);
  }
  const idleById = new Map(idle.top.map((t) => [t.id, t.monthlyUsd]));
  // The month to date the page shows (its product's total split in cents), so drivers add up to their products
  if (shown) for (const d of drivers.values()) d.mtd = shown.get(d.id)?.usd ?? round2(d.mtd);
  return [...drivers.values()]
    .sort((a, b) => b.mtd - a.mtd)
    .slice(0, COST_DRIVERS)
    .map((d) => ({
      id: d.id,
      env: d.env,
      kind: d.kind,
      name: d.name,
      mtdUsd: round2(d.mtd),
      idleMonthlyUsd: idleById.get(d.id) ?? 0,
      spike: spikes.find((s) => s.resourceId === d.id) ?? null,
      daily: { days: sparkDays, values: sparkDays.map((day) => Math.round((d.byDay.get(day) ?? 0) * 1000) / 1000) },
    }));
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

export interface ExtraDays {
  bunny: DayCost[];
  containers: DayCost[];
  ai: DayCost[];
  resend: DayCost[];
  /** Where each came from: the collector's billing pulls (COST-1) or the older per-app estimates. */
  sources: { bunny: 'billing' | 'estimate' | 'none'; containers: 'billing' | 'estimate' | 'none'; resend: 'emails' | 'none' };
}

/** cost_product_daily rows (COST-1 collector), per product and env. */
export interface ProductDay {
  day: string;
  env: string;
  product: string;
  quantity: number | null;
  unit: string | null;
  cost: number;
}

export async function loadProductDays(env: CostDbs, since: string): Promise<ProductDay[]> {
  return rows<ProductDay>(env.COSTS_DB, 'SELECT day, env, product, quantity, unit, cost_usd AS cost FROM cost_product_daily WHERE day >= ?', since);
}

export async function loadExtraDays(env: CostDbs, since: string, productDays?: ProductDay[]): Promise<ExtraDays> {
  const products = productDays ?? (await loadProductDays(env, since));
  const [delivery, ai] = await Promise.all([
    rows<{ day: string; provider: string; metric: string; value: number }>(
      env.SEARCH_DB,
      "SELECT day, provider, metric, value FROM delivery_cost_daily WHERE day >= ? AND ((provider = 'bunny' AND metric = 'cost_usd') OR (provider = 'r2' AND metric = 'container_seconds'))",
      since,
    ),
    rows<DayCost>(env.REPORTS_DB, 'SELECT day, SUM(usd) AS cost FROM ai_usage_daily WHERE day >= ? GROUP BY day', since),
  ]);
  const of = (product: string) => sumByDay(products.filter((p) => p.product === product));
  const bunnyBilling = of('bunny');
  const containersBilling = of('containers');
  const bunnyEstimate = delivery.filter((d) => d.provider === 'bunny').map((d) => ({ day: d.day, cost: num(d.value) }));
  const containersEstimate = delivery.filter((d) => d.provider === 'r2').map((d) => ({ day: d.day, cost: num(d.value) * CONTAINER_USD_PER_SECOND }));
  const resend = of('resend');
  return {
    bunny: bunnyBilling.length ? bunnyBilling : bunnyEstimate,
    containers: containersBilling.length ? containersBilling : containersEstimate,
    ai: ai.map((d) => ({ day: d.day, cost: num(d.cost) })),
    resend,
    sources: {
      bunny: bunnyBilling.length ? 'billing' : bunnyEstimate.length ? 'estimate' : 'none',
      containers: containersBilling.length ? 'billing' : containersEstimate.length ? 'estimate' : 'none',
      resend: resend.length ? 'emails' : 'none',
    },
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

/** What an alert email says, in data (rendered per subscriber language by lib/cost-alert-mail.ts). */
export type CostAlertData =
  | { type: 'budget'; month: string; level: number; mtd: number; cap: number; projected: number }
  | { type: 'projected'; month: string; mtd: number; cap: number; projected: number }
  | { type: 'spike'; env: string; name: string; resource: boolean; day: string; cost: number; baseline: number };

export interface CostAlert {
  key: string;
  title: string;
  message: string;
  value: number;
  kind: 'budget' | 'spike';
  data: CostAlertData;
}

const usd = (v: number) => `$${v.toFixed(2)}`;

/**
 * The alerts that should be open now. Budget alerts are for the account as a whole, so only the
 * production admin raises them (its collector covers every env); spikes are raised everywhere.
 */
export function wantedAlerts(
  budget: BudgetStatus | null,
  spikes: Spike[],
  settings: Pick<CostAlertSettings, 'budgetLevels' | 'projectedAlert'> = COST_ALERT_DEFAULTS,
): CostAlert[] {
  const out: CostAlert[] = [];
  if (budget && budget.capUsd !== null && budget.share !== null && budget.projectedShare !== null) {
    for (const level of settings.budgetLevels) {
      if (budget.share < level) continue;
      const pct = Math.round(level * 100);
      out.push({
        key: `ops-cost:budget:${budget.month}:${pct}`,
        title: level >= 1 ? (level > 1 ? `${pct}% of the monthly budget used` : 'Monthly budget used up') : `${pct}% of the monthly budget used`,
        message: `${usd(budget.mtd)} of ${usd(budget.capUsd)} spent in ${budget.month}; projected ${usd(budget.projected)} by the end of the month`,
        value: budget.mtd,
        kind: 'budget',
        data: { type: 'budget', month: budget.month, level, mtd: budget.mtd, cap: budget.capUsd, projected: budget.projected },
      });
    }
    if (settings.projectedAlert && budget.projectedShare >= 1) {
      out.push({
        key: `ops-cost:projected:${budget.month}`,
        title: 'Projected to go over the monthly budget',
        message: `Projected ${usd(budget.projected)} for ${budget.month} against ${usd(budget.capUsd)} (${usd(budget.mtd)} so far)`,
        value: budget.projected,
        kind: 'budget',
        data: { type: 'projected', month: budget.month, mtd: budget.mtd, cap: budget.capUsd, projected: budget.projected },
      });
    }
  }
  for (const s of spikes) {
    out.push({
      key: s.key,
      title: s.resourceId ? 'Spend jump on a resource' : 'Daily spend jumped',
      message: `${s.name} (${s.env}) cost ${usd(s.cost)} on ${s.day}, against ${usd(s.baseline)} a day over the previous ${BASELINE_DAYS} days`,
      value: s.cost,
      kind: 'spike',
      data: { type: 'spike', env: s.env, name: s.name, resource: !!s.resourceId, day: s.day, cost: s.cost, baseline: s.baseline },
    });
  }
  return out;
}

/** The end of the newest collected hour today (ops_hourly), or now when it can't tell. */
export async function dataReachesUntil(db: D1Database | undefined, now: Date): Promise<Date> {
  if (!db) return now;
  try {
    const row = await db.prepare('SELECT MAX(hour) AS hour FROM ops_hourly WHERE hour >= ?').bind(`${now.toISOString().slice(0, 10)}T00:00:00Z`).first<{ hour: string | null }>();
    const t = row?.hour ? Date.parse(row.hour) : NaN;
    return Number.isFinite(t) ? new Date(Math.min(now.getTime(), t + 3_600_000)) : now;
  } catch {
    return now;
  }
}

/**
 * Everything the one budget counts (COST-GAPS), loaded once: Cloudflare as billed after the
 * included usage, Bunny, Containers, Workers AI, Resend, the plan and the fixed and other costs.
 * The Costs page, the alert tick and the Operations page's spend line all use it.
 */
export async function loadBudget(env: CostDbs, now: Date, settings: CostAlertSettings, since = costWindowStart(now), pre?: { resourceDays?: ResourceDay[]; productDays?: ProductDay[] }) {
  const { loadMeterDays, billedCloudflare } = await import('./cfBilling');
  const { fixedCostsBudget } = await import('./fixedCosts');
  const [resourceDays, productDays, meterDays, fixed] = await Promise.all([
    pre?.resourceDays ?? loadResourceDays(env, since),
    pre?.productDays ?? loadProductDays(env, since),
    loadMeterDays(env.COSTS_DB, since),
    fixedCostsBudget(env.COSTS_DB, now),
  ]);
  const extras = await loadExtraDays(env, since, productDays);
  const coveredUntil = await dataReachesUntil(env.COSTS_DB, now);
  const billed = billedCloudflare(meterDays, now, coveredUntil);
  const budget = budgetStatus({ cloudflare: sumByDay(resourceDays), ...extras }, now, settings.budgetUsd, settings.budgetLevels, {
    cloudflare: { mtd: billed.mtd.total, projected: billed.projected.total },
    fixed: { mtd: fixed.mtd, projected: fixed.projected },
  });
  return { budget, billed, fixed, resourceDays, productDays, extras, meterDays, coveredUntil };
}

/** The alert settings (COSTS_DB cost_settings 'alerts'), defaults when unset or not migrated. */
export async function loadCostSettings(db: D1Database | undefined): Promise<CostAlertSettings> {
  if (!db) return parseCostAlertSettings(null);
  try {
    const row = await db.prepare("SELECT value FROM cost_settings WHERE key = 'alerts'").first<{ value: string }>();
    return parseCostAlertSettings(row?.value);
  } catch {
    return parseCostAlertSettings(null);
  }
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
    // Spend lives on Costs (owner 2026-11-21): a jump opens the drivers table, the budget alerts the page
    action: { key: a.key, source: 'ops', title: a.title, itemType: 'ops-cost', itemId: a.key, itemUrl: a.key.startsWith('ops-cost:spike:') ? '/costs#drivers' : '/costs' },
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
  /** Emails the newly opened alerts to the admins who subscribed (lib/cost-alert-mail.ts). */
  notify?: (fresh: CostAlert[]) => Promise<void>,
): Promise<{ opened: number; resolved: number }> {
  const db = env.COSTS_DB;
  if (!db) return { opened: 0, resolved: 0 };
  const settings = await loadCostSettings(db);
  const since = costWindowStart(now);
  const resourceDays = await loadResourceDays(env, since);
  const budget = env.ENVIRONMENT === 'production' ? (await loadBudget(env, now, settings, since, { resourceDays })).budget : null;
  const wanted = wantedAlerts(budget, findSpikes(resourceDays, now, spikeRuleOf(settings)), settings);
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
  if (fresh.length && notify) {
    try {
      await notify(fresh);
    } catch (error) {
      logger.error('[OpsCost] Could not queue the alert emails', { error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (fresh.length || stale.length) logger.info('[OpsCost] Spend alerts updated', { opened: fresh.length, resolved: stale.length, open: wanted.length });
  return { opened: fresh.length, resolved: stale.length };
}
