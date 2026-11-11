/**
 * Moderation report statistics (GET /api/moderation/reports/stats) and the
 * QA/stage purge of E2E reports.
 *
 * The stats used to run seven queries, each a full scan of `reports`, on every
 * dashboard render. Under E2E load that was ~2B D1 rows read a day on QA
 * (2026-11-11). One grouped scan now gives every number, and the table stays
 * small because QA/stage drop the admin E2E suite's reports once its runs are over.
 */
import type { D1Database } from './types';

export interface ReportStatsResult {
  total: number;
  byStatus: { pending: number; reviewing: number; resolved: number; dismissed: number };
  byEntityType: Record<string, number>;
  byAction: Record<string, number>;
  recentActivity: { last24Hours: number; last7Days: number; last30Days: number };
}

interface StatsRow {
  entity_type: string;
  status: string;
  action: string | null;
  n: number;
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

const DAY = 86_400_000;

export async function computeReportStats(db: D1Database, now = new Date()): Promise<ReportStatsResult> {
  const since = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  const { results } = await db
    .prepare(
      `SELECT entity_type, status, action, COUNT(*) AS n,
              SUM(created_at >= ?1) AS d1, SUM(created_at >= ?2) AS d7, SUM(created_at >= ?3) AS d30
       FROM reports GROUP BY entity_type, status, action`,
    )
    .bind(since(1), since(7), since(30))
    .all<StatsRow>();

  const stats: ReportStatsResult = {
    total: 0,
    byStatus: { pending: 0, reviewing: 0, resolved: 0, dismissed: 0 },
    byEntityType: {},
    byAction: {},
    recentActivity: { last24Hours: 0, last7Days: 0, last30Days: 0 },
  };
  for (const row of results ?? []) {
    const n = Number(row.n) || 0;
    stats.total += n;
    if (row.status in stats.byStatus) stats.byStatus[row.status as keyof ReportStatsResult['byStatus']] += n;
    stats.byEntityType[row.entity_type] = (stats.byEntityType[row.entity_type] ?? 0) + n;
    if (row.action) stats.byAction[row.action] = (stats.byAction[row.action] ?? 0) + n;
    stats.recentActivity.last24Hours += Number(row.d1) || 0;
    stats.recentActivity.last7Days += Number(row.d7) || 0;
    stats.recentActivity.last30Days += Number(row.d30) || 0;
  }
  return stats;
}

/** Reports the admin E2E suite files (apps/admin-web/e2e/support/env.ts E2E_ENTITY_ROOT). */
export const E2E_REPORT_ENTITY_PREFIX = 'e2e-admin-';
/** Longer than any E2E run (the jobs time out after ~4 h), so a running spec never loses its report. */
export const E2E_REPORT_RETENTION_HOURS = 6;

/**
 * QA/stage only: deletes admin E2E reports older than the retention (~6k a day
 * on QA, which grew the table to 28k rows in five days). Production never has
 * them and is never touched. The created_at index bounds the rows read.
 */
export async function purgeE2eReports(db: D1Database, environment: string | undefined, now = new Date(), limit = 5000): Promise<number> {
  if (!environment || environment === 'production') return 0;
  const cutoff = new Date(now.getTime() - E2E_REPORT_RETENTION_HOURS * 3_600_000).toISOString();
  const res = await db
    .prepare(
      `DELETE FROM reports WHERE id IN (
         SELECT id FROM reports WHERE created_at < ?1 AND substr(entity_id, 1, ?2) = ?3 LIMIT ?4)`,
    )
    .bind(cutoff, E2E_REPORT_ENTITY_PREFIX.length, E2E_REPORT_ENTITY_PREFIX, limit)
    .run();
  return Number((res.meta as { changes?: number } | undefined)?.changes ?? 0);
}
