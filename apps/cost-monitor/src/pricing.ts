/**
 * List prices (Workers Paid, 2026-11), USD. Estimates only: the account-level
 * included allowances are not subtracted per resource (the account is shared
 * with other projects; cost spec §3.4 covers "our share"), so these numbers
 * are an upper bound and are labelled "estimated" in the admin.
 */
import type { ResourceKind } from './manifest';

export const PRICES = {
  workerRequestPerMillion: 0.3,
  workerCpuMsPerMillion: 0.02,
  d1RowsReadPerMillion: 0.001,
  d1RowsWrittenPerMillion: 1,
  d1GbMonth: 0.75,
  r2GbMonth: 0.015,
  r2ClassAPerMillion: 4.5,
  r2ClassBPerMillion: 0.36,
  /** A delivered message is a write, a read and a delete: three billable operations. */
  queueOperationsPerMillion: 0.4,
  kvReadsPerMillion: 0.5,
  /** Writes, deletes and lists are all billed at this price. */
  kvWritesPerMillion: 5,
  kvGbMonth: 0.5,
  doRequestsPerMillion: 0.15,
  doGbSecondsPerMillion: 12.5,
  doStorageReadUnitsPerMillion: 0.2,
  doStorageWriteUnitsPerMillion: 1,
} as const;

/** Workers Paid: the monthly subscription every account pays, whatever the usage. */
export const PLAN_BASE_USD = 5;

/** The monthly infrastructure cap the admin shows usage against (owner constraint). */
export const MONTHLY_CAP_USD = 500;

const GB = 1024 ** 3;
const DAYS_PER_MONTH = 30;

export interface DayUsage {
  requests?: number | null;
  /** Worker CPU: request count × p50 µs is the closest per-day figure we keep. */
  cpu_p50?: number | null;
  reads?: number | null;
  writes?: number | null;
  stored_bytes?: number | null;
  /** Durable Object duration. */
  gb_seconds?: number | null;
}

/** Estimated cost of one resource for one day. */
export function dayCost(kind: ResourceKind, u: DayUsage): number {
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  let usd = 0;
  switch (kind) {
    case 'worker': {
      usd += (n(u.requests) / 1e6) * PRICES.workerRequestPerMillion;
      const cpuMs = (n(u.requests) * n(u.cpu_p50)) / 1000;
      usd += (cpuMs / 1e6) * PRICES.workerCpuMsPerMillion;
      break;
    }
    case 'd1':
      usd += (n(u.reads) / 1e6) * PRICES.d1RowsReadPerMillion + (n(u.writes) / 1e6) * PRICES.d1RowsWrittenPerMillion;
      usd += ((n(u.stored_bytes) / GB) * PRICES.d1GbMonth) / DAYS_PER_MONTH;
      break;
    case 'r2':
      usd += (n(u.writes) / 1e6) * PRICES.r2ClassAPerMillion + (n(u.reads) / 1e6) * PRICES.r2ClassBPerMillion;
      usd += ((n(u.stored_bytes) / GB) * PRICES.r2GbMonth) / DAYS_PER_MONTH;
      break;
    case 'queue':
      usd += ((n(u.writes) * 3) / 1e6) * PRICES.queueOperationsPerMillion;
      break;
    case 'kv':
      usd += (n(u.reads) / 1e6) * PRICES.kvReadsPerMillion + (n(u.writes) / 1e6) * PRICES.kvWritesPerMillion;
      usd += ((n(u.stored_bytes) / GB) * PRICES.kvGbMonth) / DAYS_PER_MONTH;
      break;
    case 'do':
      usd += (n(u.requests) / 1e6) * PRICES.doRequestsPerMillion + (n(u.gb_seconds) / 1e6) * PRICES.doGbSecondsPerMillion;
      usd += (n(u.reads) / 1e6) * PRICES.doStorageReadUnitsPerMillion + (n(u.writes) / 1e6) * PRICES.doStorageWriteUnitsPerMillion;
      break;
  }
  return Math.round(usd * 1e6) / 1e6;
}
