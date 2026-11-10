/**
 * Contact messages and their staff thread in D1 (REPORTS_DB, migration 0008).
 * Uses only prepare/bind/first/all/run/batch, so tests run it on node:sqlite.
 */
import type { D1Database } from './types';
import type { ContactInput, ContactRateLimits, ContactStatus, ContactTopic } from './contact';

export interface ContactMessageRow {
  id: string;
  status: ContactStatus;
  topic: ContactTopic;
  name: string;
  email: string;
  message: string;
  user_id: string | null;
  locale: 'en' | 'ar';
  page_url: string | null;
  user_agent: string | null;
  assignee_id: string | null;
  assignee_email: string | null;
  notify_status: string | null;
  ack_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactNoteRow {
  id: string;
  message_id: string;
  kind: 'note' | 'reply';
  body: string;
  author_id: string;
  author_email: string | null;
  email_to: string | null;
  email_subject: string | null;
  email_status: string | null;
  email_id: string | null;
  created_at: string;
}

/** Rows written by a statement (D1 meta.changes). */
const changes = (meta: unknown) => Number((meta as { changes?: number } | undefined)?.changes ?? 0);

/** Every column except ip_hash, which never leaves the database. */
const MESSAGE_COLUMNS =
  'id, status, topic, name, email, message, user_id, locale, page_url, user_agent, assignee_id, assignee_email, notify_status, ack_status, created_at, updated_at';

export interface NewContactMessage extends ContactInput {
  id: string;
  userId: string | null;
  userAgent: string | null;
  ipHash: string;
  now: Date;
}

/**
 * Stores the message unless the sender is over a limit, in one conditional
 * INSERT: parallel requests cannot both slip under the limit, because D1 runs
 * the count and the insert as one statement. Returns false when limited.
 */
export async function insertContactMessage(db: D1Database, m: NewContactMessage, limits: ContactRateLimits): Promise<boolean> {
  const now = m.now.toISOString();
  const hourAgo = new Date(m.now.getTime() - 3600_000).toISOString();
  const dayAgo = new Date(m.now.getTime() - 86400_000).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO contact_messages (id, status, topic, name, email, message, user_id, locale, page_url, user_agent, ip_hash, created_at, updated_at)
       SELECT ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM contact_messages WHERE ip_hash = ? AND created_at > ?) < ?
         AND (SELECT COUNT(*) FROM contact_messages WHERE ip_hash = ? AND created_at > ?) < ?
         AND (? IS NULL OR (SELECT COUNT(*) FROM contact_messages WHERE user_id = ? AND created_at > ?) < ?)
         AND (? IS NULL OR (SELECT COUNT(*) FROM contact_messages WHERE user_id = ? AND created_at > ?) < ?)`,
    )
    .bind(
      m.id, m.topic, m.name, m.email, m.message, m.userId, m.locale, m.pageUrl, m.userAgent, m.ipHash, now, now,
      m.ipHash, hourAgo, limits.perIpHour,
      m.ipHash, dayAgo, limits.perIpDay,
      m.userId, m.userId, hourAgo, limits.perUserHour,
      m.userId, m.userId, dayAgo, limits.perUserDay,
    )
    .run();
  return changes(result.meta) > 0;
}

export async function setDeliveryStatus(db: D1Database, id: string, field: 'notify_status' | 'ack_status', status: string): Promise<void> {
  // The column name comes from the union above, never from input
  await db.prepare(`UPDATE contact_messages SET ${field} = ? WHERE id = ?`).bind(status, id).run();
}

export interface ContactListFilters {
  status?: ContactStatus;
  topic?: ContactTopic;
  /** YYYY-MM-DD, inclusive, UTC */
  from?: string;
  /** YYYY-MM-DD, inclusive, UTC */
  to?: string;
  /** Matches name, email or message text */
  q?: string;
  /** 'me' (needs viewerId) or 'unassigned' */
  assignee?: 'me' | 'unassigned';
  viewerId?: string;
  limit: number;
  offset: number;
}

/** LIKE pattern with the wildcard characters in the search escaped. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export async function listContactMessages(db: D1Database, f: ContactListFilters): Promise<{ messages: ContactMessageRow[]; total: number }> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.status) {
    where.push('status = ?');
    args.push(f.status);
  }
  if (f.topic) {
    where.push('topic = ?');
    args.push(f.topic);
  }
  if (f.from) {
    where.push('created_at >= ?');
    args.push(`${f.from}T00:00:00.000Z`);
  }
  if (f.to) {
    where.push('created_at <= ?');
    args.push(`${f.to}T23:59:59.999Z`);
  }
  if (f.q) {
    where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')");
    const p = likePattern(f.q);
    args.push(p, p, p);
  }
  if (f.assignee === 'me' && f.viewerId) {
    where.push('assignee_id = ?');
    args.push(f.viewerId);
  } else if (f.assignee === 'unassigned') {
    where.push('assignee_id IS NULL');
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, count] = await db.batch([
    db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM contact_messages ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(...args, f.limit, f.offset),
    db.prepare(`SELECT COUNT(*) AS total FROM contact_messages ${clause}`).bind(...args),
  ]);
  return {
    messages: (rows.results ?? []) as ContactMessageRow[],
    total: Number((count.results?.[0] as { total?: number } | undefined)?.total ?? 0),
  };
}

/** Counts for the admin nav badge and the inbox header. */
export async function contactCounts(db: D1Database): Promise<Record<ContactStatus, number>> {
  const { results } = await db.prepare('SELECT status, COUNT(*) AS n FROM contact_messages GROUP BY status').all<{ status: ContactStatus; n: number }>();
  const counts: Record<ContactStatus, number> = { new: 0, open: 0, replied: 0, closed: 0, spam: 0 };
  for (const row of results ?? []) counts[row.status] = Number(row.n);
  return counts;
}

export async function getContactMessage(db: D1Database, id: string): Promise<ContactMessageRow | null> {
  return db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM contact_messages WHERE id = ?`).bind(id).first<ContactMessageRow>();
}

export async function listContactNotes(db: D1Database, messageId: string): Promise<ContactNoteRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM contact_notes WHERE message_id = ? ORDER BY created_at ASC, id ASC')
    .bind(messageId)
    .all<ContactNoteRow>();
  return results ?? [];
}

export interface ContactPatch {
  status?: ContactStatus;
  /** undefined: unchanged; null: unassign */
  assignee?: { id: string; email: string | null } | null;
}

/** Applies the patch; false when the message does not exist. */
export async function updateContactMessage(db: D1Database, id: string, patch: ContactPatch, now: Date): Promise<boolean> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.status) {
    sets.push('status = ?');
    args.push(patch.status);
  }
  if (patch.assignee !== undefined) {
    sets.push('assignee_id = ?', 'assignee_email = ?');
    args.push(patch.assignee?.id ?? null, patch.assignee?.email ?? null);
  }
  sets.push('updated_at = ?');
  args.push(now.toISOString());
  const result = await db.prepare(`UPDATE contact_messages SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run();
  return changes(result.meta) > 0;
}

export async function insertContactNote(db: D1Database, note: ContactNoteRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO contact_notes (id, message_id, kind, body, author_id, author_email, email_to, email_subject, email_status, email_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(note.id, note.message_id, note.kind, note.body, note.author_id, note.author_email, note.email_to, note.email_subject, note.email_status, note.email_id, note.created_at)
    .run();
}

/** Deletes the message and its thread; false when it did not exist. */
export async function deleteContactMessage(db: D1Database, id: string): Promise<boolean> {
  const [, removed] = await db.batch([
    db.prepare('DELETE FROM contact_notes WHERE message_id = ?').bind(id),
    db.prepare('DELETE FROM contact_messages WHERE id = ?').bind(id),
  ]);
  return changes(removed.meta) > 0;
}
