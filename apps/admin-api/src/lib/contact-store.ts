/**
 * Contact messages and their staff thread in D1 (REPORTS_DB, migration 0008).
 * Uses only prepare/bind/first/all/run/batch, so tests run it on node:sqlite.
 */
import type { D1Database, D1PreparedStatement } from './types';
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
  /** Set while a delivery of this message has finally failed (migration 0011) */
  send_failed_at: string | null;
  delivery_error: string | null;
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
  email_error?: string | null;
  created_at: string;
}

/** Rows written by a statement (D1 meta.changes). */
const changes = (meta: unknown) => Number((meta as { changes?: number } | undefined)?.changes ?? 0);

/** Every column except ip_hash, which never leaves the database. */
const MESSAGE_COLUMNS =
  'id, status, topic, name, email, message, user_id, locale, page_url, user_agent, assignee_id, assignee_email, notify_status, ack_status, send_failed_at, delivery_error, created_at, updated_at';

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
      `INSERT INTO contact_messages (id, status, topic, name, email, message, user_id, locale, page_url, user_agent, ip_hash, notify_status, ack_status, created_at, updated_at)
       SELECT ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', ?, ?
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
  /** A status, or send_failed: messages with a finally failed delivery */
  status?: ContactStatus | 'send_failed';
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
  // Soft-deleted messages are only in the "Recently deleted" view (listDeletedContactMessages)
  const where: string[] = ['deleted_at IS NULL'];
  const args: unknown[] = [];
  if (f.status === 'send_failed') {
    where.push('send_failed_at IS NOT NULL');
  } else if (f.status) {
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
  const clause = `WHERE ${where.join(' AND ')}`;
  const [rows, count] = await db.batch([
    db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM contact_messages ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(...args, f.limit, f.offset),
    db.prepare(`SELECT COUNT(*) AS total FROM contact_messages ${clause}`).bind(...args),
  ]);
  return {
    messages: (rows.results ?? []) as ContactMessageRow[],
    total: Number((count.results?.[0] as { total?: number } | undefined)?.total ?? 0),
  };
}

export type ContactCounts = Record<ContactStatus | 'send_failed', number>;

/** Counts for the admin nav badge and the inbox header; send_failed needs an admin's action. */
export async function contactCounts(db: D1Database): Promise<ContactCounts> {
  const [byStatus, failed] = await db.batch([
    db.prepare('SELECT status, COUNT(*) AS n FROM contact_messages WHERE deleted_at IS NULL GROUP BY status'),
    db.prepare('SELECT COUNT(*) AS n FROM contact_messages WHERE send_failed_at IS NOT NULL AND deleted_at IS NULL'),
  ]);
  const counts: ContactCounts = { new: 0, open: 0, replied: 0, closed: 0, spam: 0, send_failed: 0 };
  for (const row of (byStatus.results ?? []) as { status: ContactStatus; n: number }[]) counts[row.status] = Number(row.n);
  counts.send_failed = Number((failed.results?.[0] as { n?: number } | undefined)?.n ?? 0);
  return counts;
}

/** A message that is not soft-deleted, or null. */
export async function getContactMessage(db: D1Database, id: string): Promise<ContactMessageRow | null> {
  return db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM contact_messages WHERE id = ? AND deleted_at IS NULL`).bind(id).first<ContactMessageRow>();
}

export async function listContactNotes(db: D1Database, messageId: string): Promise<ContactNoteRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM contact_notes WHERE message_id = ? ORDER BY created_at ASC, id ASC')
    .bind(messageId)
    .all<ContactNoteRow>();
  return results ?? [];
}

/**
 * A message and its notes from one D1 batch (one transaction, so one snapshot).
 * Read separately, a reply delivered between the two reads showed its note as
 * sent while the message still said "open"; the admin page stops re-reading once
 * nothing is queued, so it stayed "open" until a manual reload.
 */
export async function getContactThread(db: D1Database, id: string): Promise<{ message: ContactMessageRow; notes: ContactNoteRow[] } | null> {
  const [message, notes] = await db.batch([
    db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM contact_messages WHERE id = ? AND deleted_at IS NULL`).bind(id),
    db.prepare('SELECT * FROM contact_notes WHERE message_id = ? ORDER BY created_at ASC, id ASC').bind(id),
  ]);
  const row = (message.results?.[0] as ContactMessageRow | undefined) ?? null;
  if (!row) return null;
  return { message: row, notes: (notes.results ?? []) as ContactNoteRow[] };
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
  const result = await db.prepare(`UPDATE contact_messages SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`).bind(...args, id).run();
  return changes(result.meta) > 0;
}

export type MailKind = 'notify' | 'ack' | 'reply';

/** Current delivery state of one email of a message (reply: the note's). */
export async function deliveryStatus(db: D1Database, messageId: string, kind: MailKind, noteId?: string): Promise<string | null | undefined> {
  if (kind === 'reply') {
    const note = await db.prepare('SELECT email_status FROM contact_notes WHERE id = ? AND message_id = ?').bind(noteId ?? '', messageId).first<{ email_status: string | null }>();
    return note ? note.email_status : undefined;
  }
  const row = await db.prepare(`SELECT ${kind === 'notify' ? 'notify_status' : 'ack_status'} AS s FROM contact_messages WHERE id = ?`).bind(messageId).first<{ s: string | null }>();
  return row ? row.s : undefined;
}

/** SQL that sets send_failed_at while any delivery of the message is failed, and clears it otherwise. */
const REFRESH_SEND_FAILED = `UPDATE contact_messages SET send_failed_at = CASE
    WHEN notify_status = 'failed' OR ack_status = 'failed'
      OR EXISTS (SELECT 1 FROM contact_notes WHERE message_id = contact_messages.id AND email_status = 'failed')
    THEN COALESCE(send_failed_at, ?) ELSE NULL END,
  delivery_error = CASE
    WHEN notify_status = 'failed' OR ack_status = 'failed'
      OR EXISTS (SELECT 1 FROM contact_notes WHERE message_id = contact_messages.id AND email_status = 'failed')
    THEN COALESCE(?, delivery_error) ELSE NULL END
  WHERE id = ?`;

/**
 * Records a delivery outcome and refreshes the message's failure flag in one
 * batch. A sent reply also marks the message replied (unless it is spam).
 */
export async function recordDelivery(
  db: D1Database,
  d: { messageId: string; kind: MailKind; noteId?: string; status: string; providerId?: string | null; error?: string | null; now: Date },
): Promise<void> {
  const now = d.now.toISOString();
  const error = d.status === 'failed' ? (d.error ?? 'unknown error').slice(0, 500) : null;
  const statements: D1PreparedStatement[] = [];
  if (d.kind === 'reply') {
    statements.push(
      db.prepare('UPDATE contact_notes SET email_status = ?, email_id = COALESCE(?, email_id), email_error = ? WHERE id = ? AND message_id = ?')
        .bind(d.status, d.providerId ?? null, error, d.noteId ?? '', d.messageId),
    );
    if (d.status === 'sent' || d.status === 'sunk') {
      statements.push(db.prepare("UPDATE contact_messages SET status = 'replied', updated_at = ? WHERE id = ? AND status <> 'spam'").bind(now, d.messageId));
    }
  } else {
    statements.push(db.prepare(`UPDATE contact_messages SET ${d.kind === 'notify' ? 'notify_status' : 'ack_status'} = ? WHERE id = ?`).bind(d.status, d.messageId));
  }
  statements.push(db.prepare(REFRESH_SEND_FAILED).bind(now, error, d.messageId));
  await db.batch(statements);
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

/** A soft-deleted message as the "Recently deleted" view lists it. */
export interface DeletedContactRow {
  id: string;
  name: string;
  email: string;
  topic: ContactTopic;
  created_at: string;
  deleted_at: string;
  deleted_by: string | null;
  delete_reason: string | null;
  purge_requested_at: string | null;
  purge_requested_by: string | null;
}

/**
 * Admin delete: marks the message (and so its thread) deleted. It leaves every
 * list, count and detail view, and stays restorable until the cleanup purges
 * it (purgeContactMessages). False when there is no such live message.
 */
export async function softDeleteContactMessage(db: D1Database, id: string, by: { actorId: string; reason: string | null; now: Date }): Promise<boolean> {
  const result = await db
    .prepare('UPDATE contact_messages SET deleted_at = ?, deleted_by = ?, delete_reason = ?, purge_requested_at = NULL, purge_requested_by = NULL WHERE id = ? AND deleted_at IS NULL')
    .bind(by.now.toISOString(), by.actorId, by.reason, id)
    .run();
  return changes(result.meta) > 0;
}

/** Brings a soft-deleted message back, also when it was queued for permanent deletion. False when it is not deleted (or already purged). */
export async function restoreContactMessage(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('UPDATE contact_messages SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, purge_requested_at = NULL, purge_requested_by = NULL WHERE id = ? AND deleted_at IS NOT NULL')
    .bind(id)
    .run();
  return changes(result.meta) > 0;
}

/** "Delete permanently now": queues a soft-deleted message for the next cleanup. False when it is not deleted. */
export async function requestContactPurge(db: D1Database, id: string, by: { actorId: string; now: Date }): Promise<boolean> {
  const result = await db
    .prepare('UPDATE contact_messages SET purge_requested_at = COALESCE(purge_requested_at, ?), purge_requested_by = COALESCE(purge_requested_by, ?) WHERE id = ? AND deleted_at IS NOT NULL')
    .bind(by.now.toISOString(), by.actorId, id)
    .run();
  return changes(result.meta) > 0;
}

/** Soft-deleted messages, most recently deleted first. */
export async function listDeletedContactMessages(db: D1Database, limit = 100): Promise<DeletedContactRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, email, topic, created_at, deleted_at, deleted_by, delete_reason, purge_requested_at, purge_requested_by
       FROM contact_messages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC LIMIT ?`,
    )
    .bind(limit)
    .all<DeletedContactRow>();
  return results ?? [];
}

/**
 * The cleanup's purge, the only code that removes contact messages: deletes
 * up to `limit` soft-deleted messages (with their thread) that were deleted
 * at or before `cutoff` or were queued for permanent deletion. Each DELETE
 * re-checks that the row is still deleted, so a restore that lands first wins.
 * Returns the purged ids.
 */
export async function purgeContactMessages(db: D1Database, cutoff: string, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT id FROM contact_messages WHERE deleted_at IS NOT NULL AND (deleted_at <= ? OR purge_requested_at IS NOT NULL)
       ORDER BY deleted_at LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all<{ id: string }>();
  const purged: string[] = [];
  for (const { id } of results ?? []) {
    const guard = 'SELECT 1 FROM contact_messages WHERE id = ? AND deleted_at IS NOT NULL AND (deleted_at <= ? OR purge_requested_at IS NOT NULL)';
    const [, removed] = await db.batch([
      db.prepare(`DELETE FROM contact_notes WHERE message_id = ? AND EXISTS (${guard})`).bind(id, id, cutoff),
      db.prepare('DELETE FROM contact_messages WHERE id = ? AND deleted_at IS NOT NULL AND (deleted_at <= ? OR purge_requested_at IS NOT NULL)').bind(id, cutoff),
    ]);
    if (changes(removed.meta) > 0) purged.push(id);
  }
  return purged;
}
