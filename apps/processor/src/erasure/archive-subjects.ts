/**
 * Per-user secrets for the queue-message archive's pseudonyms (#1177, NOTIFICATIONS_DB
 * archive_subjects; rules in @al-ummah/shared-types archive-privacy).
 *
 * - `archivePseudonyms` returns the pseudonym of each user id, creating a secret on first use.
 *   Lookups go by primary key, in chunks (never a scan).
 * - `eraseArchiveSubject` (account erasure) clears the user's secret and stamps erased_at: the
 *   pseudonyms already written can no longer be tied to the account, and any later message about
 *   it archives the erased marker instead of a new pseudonym.
 */
import {
  ARCHIVE_ANONYMOUS_MARKER,
  ARCHIVE_ERASED_MARKER,
  archivePseudonym,
  archiveSubjectKey,
  newArchiveSecret,
} from '@al-ummah/shared-types';
import type { D1Database } from '../types';

/** D1 binds at most 100 parameters per statement. */
const CHUNK = 50;

interface SubjectRow {
  subject: string;
  secret: string | null;
  erased_at: number | null;
}

async function readSubjects(db: D1Database, subjects: string[]): Promise<Map<string, SubjectRow>> {
  const rows = new Map<string, SubjectRow>();
  for (let i = 0; i < subjects.length; i += CHUNK) {
    const part = subjects.slice(i, i + CHUNK);
    const result = await db
      .prepare(`SELECT subject, secret, erased_at FROM archive_subjects WHERE subject IN (${part.map(() => '?').join(',')})`)
      .bind(...part)
      .all<SubjectRow>();
    for (const row of result.results ?? []) rows.set(row.subject, row);
  }
  return rows;
}

/**
 * Pseudonym (or marker) for each user id. Without a database every id becomes the anonymous
 * marker: nothing that leads to the person is archived.
 */
export async function archivePseudonyms(db: D1Database | undefined, userIds: Iterable<string>, now = Date.now()): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  if (!db) {
    for (const id of ids) out.set(id, ARCHIVE_ANONYMOUS_MARKER);
    return out;
  }
  const subjectOf = new Map<string, string>();
  for (const id of ids) subjectOf.set(id, await archiveSubjectKey(id));
  let rows = await readSubjects(db, [...subjectOf.values()]);
  const missing = [...subjectOf.values()].filter((s) => !rows.has(s));
  if (missing.length > 0) {
    // Two writers may race to create the same subject: OR IGNORE keeps the first, the reread uses it
    await db.batch(
      missing.map((subject) =>
        db.prepare('INSERT OR IGNORE INTO archive_subjects (subject, secret, created_at) VALUES (?, ?, ?)').bind(subject, newArchiveSecret(), now)
      )
    );
    rows = new Map([...rows, ...(await readSubjects(db, missing))]);
  }
  for (const id of ids) {
    const row = rows.get(subjectOf.get(id)!);
    if (!row || row.erased_at != null || !row.secret) out.set(id, ARCHIVE_ERASED_MARKER);
    else out.set(id, await archivePseudonym(row.secret, id));
  }
  return out;
}

/** Account erasure: the user's secret is gone for good; idempotent. Returns 1 when a row changed. */
export async function eraseArchiveSubject(db: D1Database | undefined, userId: string, now = Date.now()): Promise<number> {
  if (!db) return 0;
  if (!userId) throw new Error('eraseArchiveSubject needs a user id');
  const subject = await archiveSubjectKey(userId);
  const result = await db
    .prepare(
      `INSERT INTO archive_subjects (subject, secret, created_at, erased_at) VALUES (?, NULL, ?, ?)
       ON CONFLICT(subject) DO UPDATE SET secret = NULL, erased_at = COALESCE(archive_subjects.erased_at, excluded.erased_at)
       RETURNING subject`
    )
    .bind(subject, now, now)
    .all();
  return (result.results ?? []).length;
}
