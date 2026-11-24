/**
 * What a report keeps of the reported person (REPORTS_DB.reports): the copies admin-api searches. Reports stay
 * for moderation history after an account erasure, without who it was or what they wrote.
 */
import { eraseTombstoneKey, type ReportSubject } from '@al-ummah/shared-types';
import type { D1Database } from '../types';

/** Reports about the erased person's content, by idx_reports_owner. Idempotent. */
export async function eraseReportedOwner(db: D1Database, userId: string, tombstone: string): Promise<void> {
  await db
    .prepare("UPDATE reports SET owner_id = ?, owner_name = NULL, entity_title = CASE WHEN entity_type IN ('comment', 'live_chat') THEN NULL ELSE entity_title END WHERE owner_id = ?")
    .bind(tombstone, userId)
    .run();
}

/** The copies a new report starts with; nothing of a person erased before this message was read. */
export async function reportSubjectFor(db: D1Database, subject: ReportSubject, tombstone: string): Promise<ReportSubject> {
  if (!subject.ownerId) return subject;
  const erased = await db.prepare('SELECT 1 AS x FROM erased_users WHERE user_key = ?').bind(await eraseTombstoneKey(subject.ownerId)).first();
  return erased ? { ...subject, text: '', ownerId: tombstone } : subject;
}
