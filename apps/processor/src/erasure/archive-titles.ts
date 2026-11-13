/**
 * An erased creator's titles in the queue-message archive (#1254, r2 al-ummah-now-messages).
 *
 * The archive keeps public titles and channel names for statistics and abuse investigation. Once
 * the creator's account is erased they become placeholders ("erased video", "erased channel",
 * @al-ummah/shared-types erasure-privacy):
 *
 * - At write time, `writeArchiveEntry` stores the scrubbed message (archive-record.ts) and, when it
 *   carries titles, one NOTIFICATIONS_DB archive_title_refs row per owner (SHA-256 subject, never
 *   the id). An owner already erased gets placeholders at once and no row.
 * - The erasure (UserDataErased) queues ArchiveTitlesErase with the subject. Each delivery reads
 *   one page of the subject's rows (primary-key range), rewrites those R2 objects with the
 *   placeholders (metadata kept) and deletes the rows; a full page queues the next one.
 * - The daily cron drops rows older than the archive's retention (the objects are gone by then).
 */
import { archiveSubjectKey, archiveTitleOwnerIds, eraseArchiveTitles, MessageType } from '@al-ummah/shared-types';
import type { AlUmmahMessage, D1Database, QueueEnvironment } from '../types';
import { archiveEntry } from '../lib/archive-record';

/** Archived messages rewritten per delivery. */
export const ARCHIVE_TITLES_PAGE = 50;
/** The archive's retention (13 months, api-videos lib/privacy/retention.ts) plus a margin. */
export const ARCHIVE_TITLE_REF_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const PURGE_BATCH = 5000;

interface R2Like {
  put(key: string, body: string, options?: Record<string, unknown>): Promise<unknown>;
  get?(key: string): Promise<{ text(): Promise<string>; httpMetadata?: Record<string, unknown>; customMetadata?: Record<string, string> } | null>;
}

/**
 * Scrubs and stores one archive entry, then indexes its titles under their owners. `extra` is added
 * to the record (typeName, timestampISO...), `customMetadata` to the object.
 */
export async function writeArchiveEntry(
  env: Pick<QueueEnvironment, 'NOTIFICATIONS_DB' | 'MESSAGES_BUCKET'>,
  key: string,
  message: AlUmmahMessage,
  extra: Record<string, unknown>,
  customMetadata: Record<string, string>,
  now = Date.now()
): Promise<{ titleRefs: number }> {
  const { record, titleSubjects } = await archiveEntry(message, env, extra);
  await (env.MESSAGES_BUCKET as unknown as R2Like).put(key, JSON.stringify(record, null, 2), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata,
  });
  const db = env.NOTIFICATIONS_DB;
  if (!db || titleSubjects.length === 0) return { titleRefs: 0 };
  await db.batch(
    titleSubjects.map((subject) =>
      db.prepare('INSERT OR IGNORE INTO archive_title_refs (subject, archive_key, created_at) VALUES (?, ?, ?)').bind(subject, key, now)
    )
  );
  return { titleRefs: titleSubjects.length };
}

/** The owners' subjects of a message's titles (for tests and the erasure's own checks). */
export async function archiveTitleSubjects(message: unknown): Promise<string[]> {
  return Promise.all([...archiveTitleOwnerIds(message)].map((id) => archiveSubjectKey(id)));
}

export interface ArchiveTitlesPage {
  rewritten: number;
  /** Refs whose object is gone (retention) or unreadable: dropped */
  missing: number;
  /** A full page: another delivery follows */
  more: boolean;
}

/** One page of the erasure: rewrites up to `limit` archived messages of the subject. Idempotent. */
export async function eraseArchiveTitlesPage(
  db: D1Database,
  bucket: R2Like,
  subject: string,
  limit = ARCHIVE_TITLES_PAGE
): Promise<ArchiveTitlesPage> {
  if (!subject) throw new Error('eraseArchiveTitlesPage needs a subject');
  const rows =
    (
      await db
        .prepare('SELECT archive_key FROM archive_title_refs WHERE subject = ? ORDER BY archive_key LIMIT ?')
        .bind(subject, limit)
        .all<{ archive_key: string }>()
    ).results ?? [];
  let rewritten = 0;
  let missing = 0;
  for (const { archive_key: key } of rows) {
    const object = bucket.get ? await bucket.get(key) : null;
    let record: unknown;
    try {
      record = object ? JSON.parse(await object.text()) : undefined;
    } catch {
      record = undefined;
    }
    if (record === undefined || !object) {
      missing++;
      continue;
    }
    await bucket.put(key, JSON.stringify(eraseArchiveTitles(record), null, 2), {
      httpMetadata: object.httpMetadata ?? { contentType: 'application/json' },
      customMetadata: object.customMetadata ?? {},
    });
    rewritten++;
  }
  if (rows.length) {
    await db.batch(rows.map((row) => db.prepare('DELETE FROM archive_title_refs WHERE subject = ? AND archive_key = ?').bind(subject, row.archive_key)));
  }
  return { rewritten, missing, more: rows.length === limit };
}

/** The erasure's step message for a user (queued by UserDataErased, then by each full page). */
export async function archiveTitlesEraseMessage(idPrefix: string, subject: string): Promise<AlUmmahMessage> {
  return {
    id: `${idPrefix}:archive-titles`,
    type: MessageType.ArchiveTitlesErase,
    timestamp: new Date().toISOString(),
    payload: { subject },
  } as AlUmmahMessage;
}

/** Daily cron: rows older than the archive's retention, a batch at a time (indexed on created_at). */
export async function purgeExpiredTitleRefs(db: D1Database, now = Date.now()): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM archive_title_refs WHERE (subject, archive_key) IN
         (SELECT subject, archive_key FROM archive_title_refs WHERE created_at < ? LIMIT ${PURGE_BATCH})`
    )
    .bind(now - ARCHIVE_TITLE_REF_RETENTION_MS)
    .run();
  return (result.meta as { changes?: number } | undefined)?.changes ?? 0;
}
