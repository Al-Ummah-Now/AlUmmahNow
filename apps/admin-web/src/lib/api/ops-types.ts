/** Shapes of admin-api /api/ops/* (Operations page, docs/admin/LIVE_OPS.md Part A). */
export const OPS_ENVS = ['production', 'stage', 'qa'] as const;
export type OpsEnv = (typeof OPS_ENVS)[number];
export const OPS_KINDS = ['worker', 'd1', 'r2', 'queue', 'kv', 'do'] as const;
export type OpsKind = (typeof OPS_KINDS)[number];
export const OPS_RANGES = ['24h', '7d', '30d'] as const;
export type OpsRange = (typeof OPS_RANGES)[number];
export type OpsMetric =
  | 'requests' | 'errors' | 'cpu_p50' | 'cpu_p99' | 'latency_p50' | 'latency_p99' | 'reads' | 'writes'
  | 'bytes' | 'stored_bytes' | 'objects' | 'backlog_avg' | 'backlog_max' | 'gb_seconds' | 'cost_usd';

export interface OpsProjection {
  mtd: number;
  linear: number;
  trailing: number;
  daysElapsed: number;
  daysInMonth: number;
}

export interface OpsOverview {
  env: OpsEnv;
  envs: OpsEnv[];
  workers: { requests: number; requestsBefore: number; errorRate: number | null; errorRateBefore: number | null; cpuP99: number | null };
  d1: { latencyP99: number | null; latencyP99Before: number | null };
  queues: { worst: { name: string; backlog: number } | null; dlqMessages: number; at: string | null };
  cost: { env: OpsProjection; all: OpsProjection; capUsd: number; estimated: boolean };
  dataAsOf: string | null;
  stale: boolean;
  alerts: { key: string; rule_id: string; resource_id: string; value: number | null; opened_at: string }[];
}

export interface OpsSeries {
  env: OpsEnv;
  kind: OpsKind;
  metric: OpsMetric;
  resource: string | null;
  range: string;
  granularity: 'hour' | 'day';
  from: string;
  points: { t: string; value: number | null }[];
}

export interface OpsResource {
  id: string;
  name: string;
  day: string;
  metrics: Partial<Record<OpsMetric, number | null>>;
  spark: { metric: OpsMetric; days: string[]; values: (number | null)[] };
  monthCostUsd: number;
}

export type OpsBudgetLevel = 'ok' | 'warn50' | 'warn80' | 'over';
export type OpsCostPart = 'cloudflare' | 'bunny' | 'containers' | 'ai' | 'plan';
/** Series of the daily spend chart: the three envs' Cloudflare spend and the other sources. */
export const OPS_TREND_KEYS = ['production', 'stage', 'qa', 'bunny', 'containers', 'ai'] as const;
export type OpsTrendKey = (typeof OPS_TREND_KEYS)[number];

export interface OpsSpike {
  key: string;
  env: string;
  resourceId: string | null;
  name: string;
  day: string;
  cost: number;
  baseline: number;
}

/** admin-api GET /api/ops/costs: spend across every source against the $500 budget. */
export interface OpsCosts {
  env: 'all' | OpsEnv;
  budget: {
    capUsd: number;
    month: string;
    mtd: number;
    projected: number;
    share: number;
    projectedShare: number;
    level: OpsBudgetLevel;
    projectedLevel: OpsBudgetLevel;
    parts: Record<OpsCostPart, { mtd: number; projected: number }>;
    levels: number[];
  };
  idle: {
    monthlyUsd: number;
    targetUsd: number;
    byEnv: Partial<Record<OpsEnv, number>>;
    parts: Record<OpsCostPart, number>;
    top: { id: string; env: string; name: string; kind: string; monthlyUsd: number }[];
    days: string[];
  };
  trend: { days: string[]; series: { key: OpsTrendKey; values: number[] }[] };
  drivers: {
    id: string;
    env: OpsEnv;
    kind: string;
    name: string;
    mtdUsd: number;
    idleMonthlyUsd: number;
    spike: OpsSpike | null;
    daily: { days: string[]; values: number[] };
  }[];
  spikes: OpsSpike[];
  estimated: boolean;
  sources: { bunny: boolean; ai: boolean };
}
