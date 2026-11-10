/**
 * Audit log for platform content actions.
 *
 * Reuses the site settings audit table (site_settings_log, migration 0006):
 * one row per action, keyed `content:<kind>:<id>`, with the action and its
 * details as JSON in new_value and the previous values (for edits) in
 * old_value. The (key, created_at) index serves both the per-item history and
 * the recent-actions feed (a range over the `content:` prefix).
 */
import type { AdminAuditEntry } from '@al-ummah/shared-types';

export type ContentKind = 'channel' | 'video' | 'comment' | 'playlist' | 'post' | 'user' | 'creator-tier';

interface AuditDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T>(): Promise<{ results?: T[] }>;
    };
  };
}

export const CONTENT_AUDIT_PREFIX = 'content:';
/** The first key after every `content:` key (';' follows ':' in ASCII). */
const CONTENT_AUDIT_END = 'content;';

export const auditKey = (kind: ContentKind, id: string) => `${CONTENT_AUDIT_PREFIX}${kind}:${id}`;

export interface AuditAction {
  kind: ContentKind;
  id: string;
  action: string;
  actorId: string;
  details?: Record<string, unknown>;
  previous?: Record<string, unknown>;
}

/** Inserts the audit row; returns its id so a failed action can drop it again. */
export async function writeAudit(db: AuditDb, entry: AuditAction, now = new Date().toISOString(), id: string = crypto.randomUUID()): Promise<string> {
  await db
    .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(
      id,
      auditKey(entry.kind, entry.id),
      entry.previous ? JSON.stringify(entry.previous) : null,
      JSON.stringify({ action: entry.action, ...(entry.details ? { details: entry.details } : {}) }),
      entry.actorId,
      now,
    )
    .run();
  return id;
}

export async function dropAudit(db: AuditDb, id: string): Promise<void> {
  await db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(id).run();
}

interface LogRow { id: string; key: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function toAuditEntry(row: LogRow): AdminAuditEntry & { previous: Record<string, unknown> | null } {
  const value = parseJson(row.new_value);
  return {
    id: row.id,
    key: row.key,
    action: typeof value?.action === 'string' ? value.action : 'unknown',
    details: (value?.details as Record<string, unknown> | undefined) ?? null,
    previous: parseJson(row.old_value),
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

/** One item's history, or (without kind/id) the latest content actions, newest first. */
export async function readAudit(db: AuditDb, opts: { kind?: ContentKind; id?: string; limit: number }) {
  const statement = opts.kind && opts.id
    ? db.prepare('SELECT id, key, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at DESC, id DESC LIMIT ?').bind(auditKey(opts.kind, opts.id), opts.limit)
    : db.prepare('SELECT id, key, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key >= ? AND key < ? ORDER BY created_at DESC, id DESC LIMIT ?').bind(CONTENT_AUDIT_PREFIX, CONTENT_AUDIT_END, opts.limit);
  const { results = [] } = await statement.all<LogRow>();
  return results.map(toAuditEntry);
}
