/**
 * How long reports stay (owner decisions, 2026-11-25):
 *
 *   reports sent without an account   deleted a year after their decision
 *   a child safety report's kept record, with those reports   at least a year after the item's last report was decided
 *                                     (the case evidence's own setting when longer), and never while a case about the
 *                                     item is open
 *
 * Daily, with the case evidence's sweep. Bounded batches over partial indexes; what is left waits for the next day.
 */
import type { ReportableEntityType } from '@al-ummah/shared-types';
import { callVideos } from '../content/videosClient';
import { casesAbout, logAccess, retentionDays, RETENTION_ACTOR } from '../csam';
import { logger } from '../logger';
import type { D1Database } from '../types';
import { GUEST_REPORTER_ID, flagAdmin, type ChildSafetyEnv } from './childSafety';

export const GUEST_REPORT_DAYS = 365;
const BATCH = 200;
const MAX_BATCHES = 25;
/** Those kept for an open case stay at the front of this list: far more than there can be of them. */
const RECORDS = 1000;

const before = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

/** Ordinary reports of people without an account; the child safety ones go with their item's record. */
export async function purgeGuestReports(db: D1Database, now = new Date()): Promise<number> {
  let deleted = 0;
  for (let n = 0; n < MAX_BATCHES; n++) {
    const out = await db
      .prepare(
        `DELETE FROM reports WHERE id IN (SELECT id FROM reports INDEXED BY idx_reports_guest_closed
         WHERE reporter_id = 'guest' AND status IN ('resolved', 'dismissed') AND resolved_at < ? AND +reason <> 'child_safety' ORDER BY resolved_at LIMIT ?)`,
      )
      .bind(before(now, GUEST_REPORT_DAYS), BATCH)
      .run();
    const changes = Number((out.meta as { changes?: number } | undefined)?.changes ?? 0);
    deleted += changes;
    if (changes < BATCH) break;
  }
  return deleted;
}

export async function purgeKeptRecords(env: ChildSafetyEnv, now = new Date()): Promise<{ deleted: number; failed: number }> {
  const db = env.REPORTS_DB as unknown as D1Database;
  const { results: due = [] } = await db
    .prepare(
      `SELECT a.entity_type, a.entity_id, a.closed_at, a.evidence FROM child_safety_alerts a
       WHERE a.closed_at IS NOT NULL AND a.closed_at < ? ORDER BY a.closed_at LIMIT ?`,
    )
    .bind(before(now, await retentionDays(env.REPORTS_DB as never)), RECORDS)
    .all<{ entity_type: ReportableEntityType; entity_id: string; closed_at: string; evidence: string | null }>();
  const inCase = await casesAbout(env.REPORTS_DB as never, due.map((r) => ({ type: r.entity_type, id: r.entity_id })), true);
  let deleted = 0;
  let failed = 0;
  for (const row of due) {
    if (inCase.has(`${row.entity_type}:${row.entity_id}`)) continue;
    try {
      // The row first, and only as it was read: a report that came in since has made it new, and its record stays
      const gone = await db.prepare('DELETE FROM child_safety_alerts WHERE entity_type = ? AND entity_id = ? AND closed_at = ?').bind(row.entity_type, row.entity_id, row.closed_at).run();
      if (Number((gone.meta as { changes?: number } | undefined)?.changes ?? 0) === 0) continue;
      try {
        // A handle that nobody had is no id, and nothing was kept under it
        const out = row.entity_id.startsWith('@')
          ? { deleted: 0 }
          : await callVideos<{ deleted: number }>(env, `/report-evidence/${encodeURIComponent(row.entity_type)}/${encodeURIComponent(row.entity_id)}`, { base: '/internal/csam', method: 'DELETE', actorId: RETENTION_ACTOR });
        if (out.deleted > 0) await logAccess(env.REPORTS_DB as never, { caseId: null, actorId: RETENTION_ACTOR, action: 'evidence.deleted', detail: { reportedItem: `${row.entity_type}:${row.entity_id}`, objects: out.deleted } });
      } catch (error) {
        // Due again tomorrow, unless a new report has started the item over
        await db
          .prepare("INSERT OR IGNORE INTO child_safety_alerts (entity_type, entity_id, created_at, alerted_at, evidence, closed_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(row.entity_type, row.entity_id, row.closed_at, row.closed_at, row.evidence, row.closed_at)
          .run();
        throw error;
      }
      await db
        .prepare("DELETE FROM reports WHERE entity_type = ? AND entity_id = ? AND reporter_id = ? AND reason = 'child_safety' AND status IN ('resolved', 'dismissed')")
        .bind(row.entity_type, row.entity_id, GUEST_REPORTER_ID)
        .run();
      deleted++;
    } catch (error) {
      failed++;
      logger.error('[ReportRetention] A kept record could not be deleted', { entityType: row.entity_type, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failed > 0) {
    await flagAdmin(env, {
      key: 'child-safety-retention',
      title: 'Kept records past their time could not be deleted',
      message: `${failed} kept record(s) could not be deleted. The sweep tries again daily.`,
      itemId: 'child-safety-retention',
      itemUrl: '/moderation?reason=child_safety',
    }).catch(() => undefined);
  }
  return { deleted, failed };
}

export async function runReportRetention(env: ChildSafetyEnv, now = new Date()): Promise<{ guestReports: number; deleted: number; failed: number }> {
  return { guestReports: await purgeGuestReports(env.REPORTS_DB as unknown as D1Database, now), ...(await purgeKeptRecords(env, now)) };
}
