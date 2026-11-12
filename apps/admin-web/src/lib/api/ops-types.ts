/** Shapes of admin-api /api/ops/* (Operations page, docs/admin/LIVE_OPS.md Part A). */
export const OPS_ENVS = ['production', 'stage', 'qa'] as const;
export type OpsEnv = (typeof OPS_ENVS)[number];
export const OPS_KINDS = ['worker', 'd1', 'r2', 'queue'] as const;
export type OpsKind = (typeof OPS_KINDS)[number];
export const OPS_RANGES = ['24h', '7d', '30d'] as const;
export type OpsRange = (typeof OPS_RANGES)[number];
export type OpsMetric =
  | 'requests' | 'errors' | 'cpu_p50' | 'cpu_p99' | 'latency_p50' | 'latency_p99' | 'reads' | 'writes'
  | 'bytes' | 'stored_bytes' | 'objects' | 'backlog_avg' | 'backlog_max' | 'cost_usd';

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
