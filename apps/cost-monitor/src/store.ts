/**
 * D1 writes of the collector (al-ummah-now-costs): idempotent hourly upserts,
 * the daily rollup with estimated cost, run records and 13-month retention.
 */
import { METRICS, type OpsRow } from './normalize';
import { dayCost } from './pricing';
import type { ResourceKind } from './manifest';

/** ops_hourly and ops_daily are kept for 13 months (docs/admin/LIVE_OPS.md §A.2). */
export const RETENTION_DAYS = 396;
export const PRUNE_BATCH = 5000;
const BATCH = 50;

export async function upsertHourly(db: D1Database, rows: OpsRow[], now: Date): Promise<number> {
  const cols = ['hour', 'resource_id', 'kind', 'env', 'name', ...METRICS, 'updated_at'];
  const sql = `INSERT INTO ops_hourly (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
    ON CONFLICT (hour, resource_id) DO UPDATE SET ${[...METRICS, 'updated_at'].map((c) => `${c} = excluded.${c}`).join(', ')}`;
  const stamp = now.toISOString();
  const statements = rows.map((r) =>
    db.prepare(sql).bind(r.hour, r.resource.id, r.resource.kind, r.resource.env, r.resource.name, ...METRICS.map((m) => r.values[m] ?? null), stamp),
  );
  for (let i = 0; i < statements.length; i += BATCH) await db.batch(statements.slice(i, i + BATCH));
  return rows.length;
}

interface DailyAgg {
  resource_id: string;
  kind: ResourceKind;
  env: string;
  name: string;
  requests: number | null;
  errors: number | null;
  cpu_weighted: number | null;
  cpu_p99: number | null;
  latency_p50: number | null;
  latency_p99: number | null;
  reads: number | null;
  writes: number | null;
  bytes: number | null;
  stored_bytes: number | null;
  objects: number | null;
  backlog_avg: number | null;
  backlog_max: number | null;
  gb_seconds: number | null;
}

/** Recomputes one UTC day of ops_daily from ops_hourly (idempotent). Returns the rows written. */
export async function rollupDay(db: D1Database, day: string, now: Date): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT resource_id, kind, env, name,
        SUM(requests) AS requests, SUM(errors) AS errors,
        SUM(requests * cpu_p50) / NULLIF(SUM(CASE WHEN cpu_p50 IS NOT NULL THEN requests END), 0) AS cpu_weighted,
        MAX(cpu_p99) AS cpu_p99, AVG(latency_p50) AS latency_p50, MAX(latency_p99) AS latency_p99,
        SUM(reads) AS reads, SUM(writes) AS writes, SUM(bytes) AS bytes,
        MAX(stored_bytes) AS stored_bytes, MAX(objects) AS objects,
        AVG(backlog_avg) AS backlog_avg, MAX(backlog_max) AS backlog_max, SUM(gb_seconds) AS gb_seconds
       FROM ops_hourly WHERE hour >= ? AND hour < ? GROUP BY resource_id, kind, env, name`,
    )
    .bind(`${day}T00:00:00Z`, new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().replace('.000Z', 'Z'))
    .all<DailyAgg>();
  const stamp = now.toISOString();
  const statements = (results ?? []).map((a) => {
    const cpuP50 = a.cpu_weighted === null ? null : Math.round(a.cpu_weighted);
    const cost = dayCost(a.kind, { requests: a.requests, cpu_p50: cpuP50, reads: a.reads, writes: a.writes, stored_bytes: a.stored_bytes, gb_seconds: a.gb_seconds });
    return db
      .prepare(
        `INSERT INTO ops_daily (day, resource_id, kind, env, name, requests, errors, cpu_p50, cpu_p99, latency_p50, latency_p99,
           reads, writes, bytes, stored_bytes, objects, backlog_avg, backlog_max, gb_seconds, cost_usd, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (day, resource_id) DO UPDATE SET requests = excluded.requests, errors = excluded.errors, cpu_p50 = excluded.cpu_p50,
           cpu_p99 = excluded.cpu_p99, latency_p50 = excluded.latency_p50, latency_p99 = excluded.latency_p99, reads = excluded.reads,
           writes = excluded.writes, bytes = excluded.bytes, stored_bytes = excluded.stored_bytes, objects = excluded.objects,
           backlog_avg = excluded.backlog_avg, backlog_max = excluded.backlog_max, gb_seconds = excluded.gb_seconds, cost_usd = excluded.cost_usd, updated_at = excluded.updated_at`,
      )
      .bind(day, a.resource_id, a.kind, a.env, a.name, a.requests, a.errors, cpuP50, a.cpu_p99, a.latency_p50, a.latency_p99,
        a.reads, a.writes, a.bytes, a.stored_bytes, a.objects, a.backlog_avg, a.backlog_max, a.gb_seconds, cost, stamp);
  });
  for (let i = 0; i < statements.length; i += BATCH) await db.batch(statements.slice(i, i + BATCH));
  return statements.length;
}

/** Deletes rows older than the retention, PRUNE_BATCH at a time per table. Returns rows deleted. */
export async function prune(db: D1Database, now: Date, days = RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const cutoffHour = cutoff.toISOString().slice(0, 13) + ':00:00Z';
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const runsCutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  let deleted = 0;
  for (const [sql, arg] of [
    ['DELETE FROM ops_hourly WHERE rowid IN (SELECT rowid FROM ops_hourly WHERE hour < ? LIMIT ?)', cutoffHour],
    ['DELETE FROM ops_daily WHERE rowid IN (SELECT rowid FROM ops_daily WHERE day < ? LIMIT ?)', cutoffDay],
    ['DELETE FROM collector_runs WHERE rowid IN (SELECT rowid FROM collector_runs WHERE started_at < ? LIMIT ?)', runsCutoff],
  ] as const) {
    for (let round = 0; round < 20; round++) {
      const r = await db.prepare(sql).bind(arg, PRUNE_BATCH).run();
      const n = r.meta?.changes ?? 0;
      deleted += n;
      if (n < PRUNE_BATCH) break;
    }
  }
  return deleted;
}

export async function startRun(db: D1Database, kind: 'hourly' | 'daily', now: Date): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO collector_runs (id, kind, started_at, status) VALUES (?, ?, ?, 'running')").bind(id, kind, now.toISOString()).run();
  return id;
}

export async function finishRun(
  db: D1Database,
  id: string,
  outcome: { status: 'ok' | 'partial' | 'failed'; queries: number; rowsWritten: number; detail?: Record<string, unknown> },
  now: Date,
): Promise<void> {
  await db
    .prepare('UPDATE collector_runs SET finished_at = ?, status = ?, queries = ?, rows_written = ?, detail = ? WHERE id = ?')
    .bind(now.toISOString(), outcome.status, outcome.queries, outcome.rowsWritten, outcome.detail ? JSON.stringify(outcome.detail).slice(0, 2000) : null, id)
    .run();
}
