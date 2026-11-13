/**
 * Erase tombstones (#1255, REPORTS_DB erased_users, admin-api migration 0024): the account erasure
 * records the SHA-256 key of the erased user id (never the id), so writes that arrive after the
 * erasure are anonymised at write time (admin-api error ingestion). Kept 30 days
 * (ERASE_TOMBSTONE_RETENTION_DAYS), purged by the daily cron.
 */
import { ERASE_TOMBSTONE_RETENTION_DAYS, eraseTombstoneKey } from '@al-ummah/shared-types';
import type { D1Database } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Idempotent; a repeated erasure moves the tombstone's date forward. */
export async function recordEraseTombstone(db: D1Database, userId: string, now = Date.now()): Promise<void> {
  if (!userId) throw new Error('recordEraseTombstone needs a user id');
  await db
    .prepare('INSERT INTO erased_users (user_key, erased_at) VALUES (?, ?) ON CONFLICT(user_key) DO UPDATE SET erased_at = excluded.erased_at')
    .bind(await eraseTombstoneKey(userId), now)
    .run();
}

/** Daily cron: tombstones older than the retention (indexed on erased_at). */
export async function purgeExpiredTombstones(db: D1Database, now = Date.now()): Promise<number> {
  const result = await db.prepare('DELETE FROM erased_users WHERE erased_at < ?').bind(now - ERASE_TOMBSTONE_RETENTION_DAYS * DAY_MS).run();
  return (result.meta as { changes?: number } | undefined)?.changes ?? 0;
}
