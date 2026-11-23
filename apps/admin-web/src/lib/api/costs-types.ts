/**
 * The Costs page's data (admin-api /api/costs, apps/admin-api/src/routers/costs.router.ts and
 * src/lib/costs.ts). The credential and settings shapes come from @al-ummah/shared-types
 * (cost-credentials.ts), the same module admin-api validates with.
 */
import type { CostAlertKind, CostAlertSettings, CostCredentialView, CostProduct, CostProvider } from '@al-ummah/shared-types';

export type { CostAlertKind, CostAlertSettings, CostCredentialView, CostProduct, CostProvider };

export type CostBudgetLevel = 'ok' | 'warn50' | 'warn80' | 'over';
export type CostBudgetPart = 'cloudflare' | 'bunny' | 'containers' | 'ai' | 'resend' | 'plan';

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

export interface CostCollectorState {
  tokenSource: CostTokenSource;
  at: string | null;
  lastJobFailures: { job: string; at: string; detail: string | null }[];
}

export interface CostSubscription {
  kinds: CostAlertKind[];
  locale: 'en' | 'ar';
  /** Where the alerts go; null until the admin opted into something. */
  email: string | null;
}

export type CostEnvKey = 'production' | 'stage' | 'qa' | 'account';

export interface CostsDashboard {
  budget: CostBudget;
  forecast: { linear: number; trailing: number };
  products: CostProductLine[];
  envs: Partial<Record<CostEnvKey, number>>;
  movers: { up: CostMover[]; down: CostMover[] };
  spikes: CostSpike[];
  trend: { days: string[]; values: number[] };
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
