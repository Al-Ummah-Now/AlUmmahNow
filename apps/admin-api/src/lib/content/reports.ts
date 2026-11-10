/**
 * Report lookups for the content pages, from REPORTS_DB (idx_reports_entity).
 * "Open" reports are the ones moderation has not closed yet.
 */
export type ReportEntity = 'channel' | 'video' | 'comment' | 'playlist' | 'post';

interface ReportsDb {
  prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } };
}

const OPEN = "status IN ('pending', 'reviewing')";
/** D1 caps bound parameters per statement at 100. */
const CHUNK = 90;
/** How many reported ids the "has reports" filter passes on to the list. */
export const MAX_REPORTED_IDS = 500;

export interface ContentReport {
  id: string;
  entityType: string;
  entityId: string;
  reporterId: string;
  reason: string;
  description: string | null;
  status: string;
  action: string | null;
  createdAt: string;
}

/** Open report counts per entity id (ids without reports are absent). */
export async function openReportCounts(db: ReportsDb, type: ReportEntity, ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { results = [] } = await db
      .prepare(`SELECT entity_id, COUNT(*) AS n FROM reports WHERE entity_type = ? AND ${OPEN} AND entity_id IN (${chunk.map(() => '?').join(',')}) GROUP BY entity_id`)
      .bind(type, ...chunk)
      .all<{ entity_id: string; n: number }>();
    for (const row of results) counts.set(row.entity_id, Number(row.n));
  }
  return counts;
}

/** Ids of entities with open reports, most recently reported first. */
export async function reportedIds(db: ReportsDb, type: ReportEntity, limit = MAX_REPORTED_IDS): Promise<string[]> {
  const { results = [] } = await db
    .prepare(`SELECT entity_id, MAX(created_at) AS last FROM reports WHERE entity_type = ? AND ${OPEN} GROUP BY entity_id ORDER BY last DESC LIMIT ?`)
    .bind(type, limit)
    .all<{ entity_id: string }>();
  return results.map((r) => r.entity_id);
}

interface ReportRow {
  id: string;
  entity_type: string;
  entity_id: string;
  reporter_id: string;
  reason: string;
  description: string | null;
  status: string;
  action: string | null;
  created_at: string;
}

/** The latest reports (any status) against these entities, newest first. */
export async function recentReports(db: ReportsDb, targets: { type: ReportEntity; ids: string[] }[], limit = 10): Promise<ContentReport[]> {
  const rows: ReportRow[] = [];
  for (const { type, ids } of targets) {
    const unique = [...new Set(ids.filter(Boolean))];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const { results = [] } = await db
        .prepare(`SELECT id, entity_type, entity_id, reporter_id, reason, description, status, action, created_at FROM reports WHERE entity_type = ? AND entity_id IN (${chunk.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT ?`)
        .bind(type, ...chunk, limit)
        .all<ReportRow>();
      rows.push(...results);
    }
  }
  return rows
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      reporterId: r.reporter_id,
      reason: r.reason,
      description: r.description,
      status: r.status,
      action: r.action,
      createdAt: r.created_at,
    }));
}
