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
import { auditOriginJson } from '../request-origin';

export type ContentKind =
  | 'channel'
  | 'video'
  | 'comment'
  | 'playlist'
  | 'post'
  | 'user'
  | 'creator-tier'
  /** A tier request's decision (id = request id; wiki AUN-TIER-REQUESTS). */
  | 'tier-request'
  /** Live streaming routing settings (id 'routing'). */
  | 'live-settings'
  /** A channel forced to one live provider (id = channel id). */
  | 'live-override'
  /** A stream's next session moved to a provider (id = stream id). */
  | 'live-stream'
  /** A live session ended by an admin (id = session id). */
  | 'live-session'
  /** A white-label scholar site (id = channel id; wiki AUN-SCHOLAR-SITES). */
  | 'site'
  /** A video category (id = its value; '*order' for a reorder). */
  | 'category'
  /** Captions & translation settings (id 'settings') and the platform Quran editions (id = language; AUN-CAPTIONS). */
  | 'captions-settings'
  /** Payments (wiki AUN-SUBS): a provider's settings or credentials (id = provider; never the value). */
  | 'billing-provider'
  /** Payments: tax and seller details (id 'tax'). */
  | 'billing-settings'
  /** Payments: a tier price (id = tier:period:currency). */
  | 'billing-price'
  /** Payments: a subscription canceled by an admin (id = subscription id). */
  | 'billing-subscription'
  /** Payments: a refund (id = payment id). */
  | 'billing-payment'
  /** Payments: a billing job retried from the Jobs page (id = the job's target). */
  | 'billing'
  /** Creator support (wiki AUN-MEMBERS): a support job retried or cancelled from the Jobs page (id = the job's target). */
  | 'support'
  /** Creator support: the organization's finance list (id = user id) and tech-staff marks */
  | 'support-finance'
  | 'support-tech-staff'
  /** Creator support: owner decisions and the organization / hold fields (id 'policy' or 'fields') */
  | 'support-settings'
  /** Creator support: a payout batch planned, approved or stopped (id = batch id or period) */
  | 'support-batch'
  /** Creator support: a country rule (id = ISO country code) */
  | 'support-country'
  /** Approval workflows (wiki AUN-WORKFLOWS): one row per step of a change request (id = request id). */
  | 'workflow'
  /** Creator support: a fee setting (id = kind:provider:currency:method; details carry the effective date) */
  | 'support-fees'
  /** Admin Tools imports (wiki TOOLS-ADMIN): a channel made for an import (id = channel id), later batches and items. */
  | 'import'
  /** A social import source (id = source id; wiki TOOLS-ADMIN TA-9): added, changed, synced, removed. */
  | 'import-source';

/** Every live streaming audit key starts with this ('content:live-'); the range ends before 'content:live.'. */
export const LIVE_AUDIT_PREFIX = `content:live-`;
const LIVE_AUDIT_END = `content:live.`;

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
    .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      id,
      auditKey(entry.kind, entry.id),
      entry.previous ? JSON.stringify(entry.previous) : null,
      JSON.stringify({ action: entry.action, ...(entry.details ? { details: entry.details } : {}) }),
      entry.actorId,
      now,auditOriginJson()
    )
    .run();
  return id;
}

/** Fills in the previous values once the change has told us what they were (a stream's move). */
export async function setAuditPrevious(db: AuditDb, id: string, previous: Record<string, unknown>): Promise<void> {
  await db.prepare('UPDATE site_settings_log SET old_value = ? WHERE id = ?').bind(JSON.stringify(previous), id).run();
}

/** Points an audit row at its subject once it has an id (a tier made by Add tier). */
export async function setAuditSubject(db: AuditDb, id: string, kind: AuditAction['kind'], subjectId: string): Promise<void> {
  await db.prepare('UPDATE site_settings_log SET key = ? WHERE id = ?').bind(auditKey(kind, subjectId), id).run();
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

/**
 * One item's history, the live streaming history (`live: true`: every live-*
 * kind), or (without kind/id) the latest content actions, newest first.
 */
export async function readAudit(db: AuditDb, opts: { kind?: ContentKind; id?: string; live?: boolean; limit: number }) {
  const statement = opts.live
    ? db.prepare('SELECT id, key, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key >= ? AND key < ? ORDER BY created_at DESC, rowid DESC LIMIT ?').bind(LIVE_AUDIT_PREFIX, LIVE_AUDIT_END, opts.limit)
    : opts.kind && opts.id
    ? db.prepare('SELECT id, key, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').bind(auditKey(opts.kind, opts.id), opts.limit)
    : db.prepare('SELECT id, key, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key >= ? AND key < ? ORDER BY created_at DESC, rowid DESC LIMIT ?').bind(CONTENT_AUDIT_PREFIX, CONTENT_AUDIT_END, opts.limit);
  const { results = [] } = await statement.all<LogRow>();
  return results.map(toAuditEntry);
}
