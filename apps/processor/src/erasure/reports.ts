/**
 * What a report keeps of the reported person (REPORTS_DB.reports): the copies admin-api searches. Reports stay
 * for moderation history after an account erasure, without who it was or what they wrote.
 */
import { eraseTombstoneKey, type ReportSubject } from '@al-ummah/shared-types';
import type { D1Database } from '../types';

/**
 * The erased person in reports about their content (idx_reports_owner) and in ban decisions
 * (idx_reports_banned_user). Titles go for every kind, as everywhere after an erasure (#1253, #1254), and the
 * name of their channel; a comment or chat message keeps the name of the channel it was written on.
 * Rows not filled yet, and refreshes, are admin-api's: its lookup drops erased people (reportMeta.ts). Idempotent.
 */
export async function eraseReportedOwner(db: D1Database, userId: string, tombstone: string): Promise<void> {
  await db.batch([
    db
      .prepare(
        "UPDATE reports SET owner_id = ?, owner_name = NULL, entity_title = NULL, channel_name = CASE WHEN entity_type IN ('comment', 'live_chat') THEN channel_name ELSE NULL END WHERE owner_id = ?"
      )
      .bind(tombstone, userId),
    db.prepare('UPDATE reports SET banned_user_id = ? WHERE banned_user_id = ?').bind(tombstone, userId),
  ]);
}

export interface NewReport {
  id: string;
  entityType: string;
  entityId: string;
  reporterId: string;
  reason: string;
  description: string | null;
  createdAt: string;
  /** What api-videos kept of the item when it was reported (a chat message goes with its stream) */
  subject: ReportSubject | null;
}

/**
 * Stores a report, without anyone erased before it was read from the queue. One statement: the erasure records
 * its tombstone first and clears the reports after, so it either finds this row or was seen by it.
 */
export async function storeReport(db: D1Database, r: NewReport, tombstone: string): Promise<void> {
  const ERASED = (n: number) => `EXISTS (SELECT 1 FROM erased_users WHERE user_key = ?${n})`;
  const insert = db
    .prepare(
      `INSERT OR IGNORE INTO reports (id, entity_type, entity_id, reporter_id, reason, description, status, created_at, entity_title, entity_parent_id, channel_id, owner_id)
       VALUES (?1, ?2, ?3, CASE WHEN ${ERASED(12)} THEN ?14 ELSE ?4 END, ?5, ?6, 'pending', ?7,
               CASE WHEN ${ERASED(13)} THEN NULL ELSE ?8 END, ?9, ?10, CASE WHEN ?11 IS NULL THEN NULL WHEN ${ERASED(13)} THEN ?14 ELSE ?11 END)`
    )
    .bind(
      r.id, r.entityType, r.entityId, r.reporterId, r.reason, r.description, r.createdAt,
      r.subject?.text || null, r.subject?.parentId ?? null, r.subject?.channelId ?? null, r.subject?.ownerId ?? null,
      await eraseTombstoneKey(r.reporterId), r.subject?.ownerId ? await eraseTombstoneKey(r.subject.ownerId) : null, tombstone,
    );
  // The alert of a child safety report is written with it (admin-api lib/moderation/childSafety.ts raises it). A
  // repeat of the message stores no second report, and leaves a closed alert closed
  const alert =
    r.reason === 'child_safety'
      ? [
          db
            .prepare(
              `INSERT INTO child_safety_alerts (entity_type, entity_id, created_at) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM reports WHERE id = ?4 AND status IN ('pending', 'reviewing'))
               ON CONFLICT(entity_type, entity_id) DO UPDATE SET created_at = excluded.created_at, alerted_at = NULL, flag_key = NULL, own_flag = 0, evidence = NULL, evidence_attempts = 0, closed_at = NULL
               WHERE child_safety_alerts.closed_at IS NOT NULL`
            )
            .bind(r.entityType, r.entityId, r.createdAt, r.id),
        ]
      : [];
  await db.batch([insert, ...alert]);
}
