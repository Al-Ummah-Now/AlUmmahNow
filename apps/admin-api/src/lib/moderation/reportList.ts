/**
 * The moderation page's list (GET /api/moderation/reports): open child safety reports first (newest first),
 * then the rest, newest first. Two ordered index ranges, never a sort of the table: the open child safety
 * reports from their partial index, the others from the (…, created_at, id) index of the first filter.
 * Counts stop at COUNT_CAP, so no request reads the whole table however long the history is.
 */
import type { ReportReason, ReportStatus, ReportableEntityType } from '@al-ummah/shared-types';
import type { D1Database, Report } from '../types';

export interface ReportListFilters {
  status?: ReportStatus | undefined;
  entity_type?: ReportableEntityType | undefined;
  reason?: ReportReason | undefined;
  entity_id?: string | undefined;
  reporter_id?: string | undefined;
}

export interface ReportListPage {
  reports: Report[];
  total: number;
  totalCapped: boolean;
  openChildSafety: number;
}

export const COUNT_CAP = 1000;
/** Written as in the partial index idx_reports_child_safety_open, or SQLite does not use it. */
const OPEN_CHILD_SAFETY = "reason = 'child_safety' AND status IN ('pending', 'reviewing')";

/** Named: the planner prefers the reason's own index, which would read every closed one too. */
const OPEN_INDEX = ' INDEXED BY idx_reports_child_safety_open';

export function listSql(f: ReportListFilters) {
  const conditions: string[] = [];
  const binds: string[] = [];
  for (const [column, value] of [['entity_id', f.entity_id], ['reporter_id', f.reporter_id], ['status', f.status], ['reason', f.reason], ['entity_type', f.entity_type]] as const) {
    if (!value) continue;
    conditions.push(`${column} = ?`);
    binds.push(value);
  }
  // The filter whose index orders the page; the others are checked on the rows read (a unary + keeps their
  // indexes out, which would mean sorting every match)
  const [lead, ...rest] = conditions;
  const ordered = [...(lead ? [lead] : []), ...rest.map((c) => `+${c}`)];
  const count = (where: string[], index = '') => `SELECT COUNT(*) AS n FROM (SELECT 1 FROM reports${index}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} LIMIT ${COUNT_CAP + 1})`;
  const also = conditions.map((c) => `+${c}`);
  return {
    binds,
    first: `SELECT * FROM reports${OPEN_INDEX} WHERE ${[OPEN_CHILD_SAFETY, ...also].join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    firstCount: count([OPEN_CHILD_SAFETY, ...also], OPEN_INDEX),
    rest: `SELECT * FROM reports WHERE ${[...ordered, `NOT (+reason = 'child_safety' AND +status IN ('pending', 'reviewing'))`].join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    total: count(ordered),
    openChildSafety: count([OPEN_CHILD_SAFETY], OPEN_INDEX),
  };
}

export async function listReports(db: D1Database, filters: ReportListFilters, limit: number, offset: number): Promise<ReportListPage> {
  const sql = listSql(filters);
  const n = async (text: string, binds: string[]) => Number((await db.prepare(text).bind(...binds).first<{ n: number }>())?.n) || 0;
  const [first, total, openChildSafety] = await Promise.all([n(sql.firstCount, sql.binds), n(sql.total, sql.binds), n(sql.openChildSafety, [])]);
  const firstRows = offset < first ? ((await db.prepare(sql.first).bind(...sql.binds, limit, offset).all<Report>()).results ?? []) : [];
  const left = limit - firstRows.length;
  const restRows = left > 0 ? ((await db.prepare(sql.rest).bind(...sql.binds, left, Math.max(0, offset - first)).all<Report>()).results ?? []) : [];
  return { reports: [...firstRows, ...restRows], total: Math.min(total, COUNT_CAP), totalCapped: total > COUNT_CAP, openChildSafety: Math.min(openChildSafety, COUNT_CAP) };
}
