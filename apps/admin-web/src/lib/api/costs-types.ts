/**
 * The Costs page's data (admin-api /api/costs, apps/admin-api/src/routers/costs.router.ts and
 * src/lib/costs.ts). The credential and settings shapes come from @al-ummah/shared-types
 * (cost-credentials.ts), the same module admin-api validates with.
 */
import type { CfMeterKey, CostAlertKind, CostAlertSettings, CostCredentialView, CostProduct, CostProvider, FixedCost, FixedCostInput, FixedCostPeriod } from '@al-ummah/shared-types';

export type { CfMeterKey, CostAlertKind, CostAlertSettings, CostCredentialView, CostProduct, CostProvider, FixedCost, FixedCostInput, FixedCostPeriod };

export type CostBudgetLevel = 'ok' | 'warn50' | 'warn80' | 'over';
export type CostBudgetPart = 'cloudflare' | 'bunny' | 'containers' | 'ai' | 'resend' | 'plan' | 'fixed';
/** Series of the daily spend chart: the three envs' Cloudflare spend (list price) and every other source. */
export const COST_TREND_KEYS = ['production', 'stage', 'qa', 'bunny', 'containers', 'ai', 'resend', 'plan', 'fixed'] as const;
export type CostTrendKey = (typeof COST_TREND_KEYS)[number];
export type CostResourceKind = 'worker' | 'd1' | 'r2' | 'queue' | 'kv' | 'do';

export interface CostBudget {
  capUsd: number | null;
  /** YYYY-MM */
  month: string;
  mtd: number;
  projected: number;
  share: number | null;
  projectedShare: number | null;
  level: CostBudgetLevel;
  projectedLevel: CostBudgetLevel;
  parts: Record<CostBudgetPart, { mtd: number; projected: number }>;
  levels: readonly number[];
}

export interface CostProductLine {
  product: CostProduct;
  mtd: number;
  projected: number;
  last7: number;
  prev7: number;
}

export interface CostMover {
  id: string;
  label: string;
  product: CostProduct;
  env: string;
  last7: number;
  prev7: number;
  change: number;
  /** The change carried over a month (×30/7). */
  monthlyImpact: number;
}

export interface CostSpike {
  key: string;
  env: string;
  resourceId: string | null;
  name: string;
  day: string;
  cost: number;
  baseline: number;
}

/** An open cost alert (ops_cost_alerts): ops-cost:budget:<month>:<pct>, ops-cost:projected:<month>, ops-cost:spike:<env>:<resource|total>. */
export interface CostAlertRow {
  key: string;
  value: number;
  opened_at: string;
}

export type CostTokenSource = 'admin' | 'release' | 'none' | 'unknown';

/** Whether Cloudflare lets the collector read Account Analytics (admin-api lib/costs.ts collectorState). */
export interface CostCollectorAnalytics {
  state: 'ok' | 'refused' | 'unknown';
  at: string | null;
  via: 'run' | 'test' | null;
}

export interface CostCollectorState {
  tokenSource: CostTokenSource;
  at: string | null;
  lastJobFailures: { job: string; at: string; detail: string | null }[];
  /** Missing from an admin-api older than COST-GAPS: read as unknown. */
  analytics?: CostCollectorAnalytics;
}

export interface CostSubscription {
  kinds: CostAlertKind[];
  locale: 'en' | 'ar';
  /** Where the alerts go; null until the admin opted into something. */
  email: string | null;
}

export type CostEnvKey = 'production' | 'stage' | 'qa' | 'account';

/** Monthly cost with nobody on the platform, against its target (opsCost.ts idleProjection). */
export interface CostIdle {
  monthlyUsd: number;
  targetUsd: number;
  byEnv: Partial<Record<'production' | 'stage' | 'qa', number>>;
  parts: Record<'cloudflare' | 'bunny' | 'containers' | 'ai' | 'plan' | 'fixed', number>;
  top: { id: string; env: string; name: string; kind: string; monthlyUsd: number }[];
  days: string[];
}

/** One resource's month so far at list price, its idle floor, its open jump and 14 days (opsCost.ts costDrivers). */
export interface CostDriver {
  id: string;
  env: 'production' | 'stage' | 'qa';
  kind: CostResourceKind;
  name: string;
  mtdUsd: number;
  idleMonthlyUsd: number;
  spike: CostSpike | null;
  daily: { days: string[]; values: number[] };
}

/** One Cloudflare invoice line for this month: usage, the account's allowance, billed and list cost. */
export interface CostCloudflareLine {
  key: CfMeterKey;
  used: number;
  included: number;
  billable: number;
  cost: number;
  listCost: number;
  projectedCost: number;
  /** measured: from the collector; estimated: derived (log events); none: no Al Ummah Now source. */
  source: 'measured' | 'estimated' | 'none';
  /** false: Cloudflare does not bill this meter yet. */
  billed: boolean;
}

export interface CostCloudflare {
  billedMtd: number;
  billedProjected: number;
  listMtd: number;
  lines: CostCloudflareLine[];
}

export interface CostsDashboard {
  budget: CostBudget;
  forecast: { linear: number; trailing: number };
  products: CostProductLine[];
  envs: Partial<Record<CostEnvKey, number>>;
  movers: { up: CostMover[]; down: CostMover[] };
  spikes: CostSpike[];
  trend: { days: string[]; values: number[]; series: { key: CostTrendKey; values: number[] }[] };
  cloudflare: CostCloudflare;
  fixed: { items: FixedCost[]; mtd: number; projected: number };
  idle: CostIdle;
  drivers: CostDriver[];
  sources: { bunny: 'billing' | 'estimate' | 'none'; containers: 'billing' | 'estimate' | 'none'; resend: 'emails' | 'none' };
  alerts: CostAlertRow[];
  settings: CostAlertSettings;
  collector: CostCollectorState;
  /** When the hourly collector last finished; null when it never has. */
  dataAsOf: string | null;
  estimated?: boolean;
  canManage: boolean;
  connections: CostCredentialView[];
  me: CostSubscription;
}

/** What admin-api returns after a save or a test (lib/costs.ts TestResult). */
export interface CostTestResult {
  ok: boolean;
  code: string;
  message: string;
  checks?: { name: string; ok: boolean }[];
}

export interface CostCredentialResult {
  view: CostCredentialView;
  test: CostTestResult;
}

/** One D1 database on the Costs page's Databases section (admin-api GET /api/costs/databases). */
export interface CostDatabase {
  id: string;
  env: string;
  name: string;
  bytes: number | null;
  share: number | null;
  growthPerDay: number | null;
  daysTo70: number | null;
  rowsWrittenPerDay: number | null;
  peakBusy: number | null;
  alerts: string[];
}

export interface CapacityRule {
  id: string;
  kind: string;
  metric: 'storage_pct' | 'storage_days_to_70' | 'busy_pct' | 'account_storage_pct';
  op: '>' | '<';
  value: number;
  window_hours: number;
  enabled: number;
}

export interface CostDatabases {
  limits: { maxDbBytes: number; accountBytes: number };
  databases: CostDatabase[];
  account: { bytes: number; databases: number; share: number; hour: string; alerts: string[] } | null;
  rules: CapacityRule[];
  canManage: boolean;
}
