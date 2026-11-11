/**
 * Warnings to videos users (user_warnings, migration 0018).
 *
 * The record moderators read: one row per warning, newest first, with its
 * place in the user's history (ordinal) and how the user was told (in-app
 * notice queued, email outcome). No imports beyond shared-types, so the SQL is
 * tested against the real migrations (test/d1-sqlite.ts).
 */
import {
  NOTIFICATION_EMAIL_LOCALES,
  REPORT_REASONS,
  REPORTABLE_ENTITY_TYPES,
  USER_WARNING_EMAIL_STATUSES,
  USER_WARNING_NOTE_MAX,
  warningEscalation,
  type IssueUserWarningRequest,
  type NotificationEmailLocale,
  type ReportReason,
  type ReportableEntityType,
  type UserWarning,
  type UserWarningEmailStatus,
  type UserWarningList,
} from '@al-ummah/shared-types';
import type { D1Database } from '../types';

/** Most warnings one history read returns. */
export const WARNING_HISTORY_MAX = 200;

export interface WarningRow {
  id: string;
  user_id: string;
  reason_code: string;
  note: string | null;
  report_id: string | null;
  entity_kind: string | null;
  entity_id: string | null;
  issued_by: string;
  issued_by_name: string;
  created_at: string;
  locale: string;
  in_app_sent: number;
  email_status: string | null;
  email_error: string | null;
  email_updated_at: string | null;
}

export class WarningInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const isReason = (v: unknown): v is ReportReason => typeof v === 'string' && (REPORT_REASONS as readonly string[]).includes(v);
const isEntityKind = (v: unknown): v is ReportableEntityType => typeof v === 'string' && (REPORTABLE_ENTITY_TYPES as readonly string[]).includes(v);
const isLocale = (v: unknown): v is NotificationEmailLocale => typeof v === 'string' && (NOTIFICATION_EMAIL_LOCALES as readonly string[]).includes(v);
const isEmailStatus =(v: unknown): v is UserWarningEmailStatus => typeof v === 'string' && (USER_WARNING_EMAIL_STATUSES as readonly string[]).includes(v);
const optionalId = (v: unknown, name: string): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 200) throw new WarningInputError('invalid_request', `${name} must be a string of at most 200 characters`);
  return v.trim() || null;
};

/** Checks a POST body; throws WarningInputError with a clear message. */
export function parseWarningRequest(body: Record<string, unknown>): IssueUserWarningRequest {
  if (!isReason(body.reasonCode)) throw new WarningInputError('invalid_reason', `reasonCode must be one of ${REPORT_REASONS.join(', ')}`);
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') throw new WarningInputError('invalid_request', 'note must be a string');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > USER_WARNING_NOTE_MAX) throw new WarningInputError('note_too_long', `note must be at most ${USER_WARNING_NOTE_MAX} characters`);
  const rawKind = body.entityKind ?? null;
  if (rawKind !== null && !isEntityKind(rawKind)) throw new WarningInputError('invalid_entity_kind', `entityKind must be one of ${REPORTABLE_ENTITY_TYPES.join(', ')}`);
  const entityKind: ReportableEntityType | null = isEntityKind(rawKind) ? rawKind : null;
  const entityId = optionalId(body.entityId, 'entityId');
  if ((entityKind === null) !== (entityId === null)) throw new WarningInputError('invalid_request', 'entityKind and entityId go together');
  const reportId = optionalId(body.reportId, 'reportId');
  if (!isLocale(body.locale)) throw new WarningInputError('invalid_locale', `locale (the email language) must be one of ${NOTIFICATION_EMAIL_LOCALES.join(', ')}`);
  return {
    reasonCode: body.reasonCode,
    locale: body.locale,
    ...(note ? { note } : {}),
    ...(reportId ? { reportId } : {}),
    ...(entityKind && entityId ? { entityKind, entityId } : {}),
  };
}

export function newWarningId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `wrn_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function toWarning(row: WarningRow, ordinal: number): UserWarning {
  return {
    id: row.id,
    userId: row.user_id,
    reasonCode: isReason(row.reason_code) ? row.reason_code : 'other',
    note: row.note,
    reportId: row.report_id,
    entityKind: isEntityKind(row.entity_kind) ? row.entity_kind : null,
    entityId: row.entity_id,
    issuedBy: row.issued_by,
    issuedByName: row.issued_by_name,
    createdAt: row.created_at,
    ordinal,
    locale: isLocale(row.locale) ? row.locale : 'en',
    inAppSent: row.in_app_sent === 1,
    emailStatus: isEmailStatus(row.email_status) ? row.email_status : null,
  };
}

export interface NewWarning extends IssueUserWarningRequest {
  id: string;
  userId: string;
  issuedBy: string;
  issuedByName: string;
  createdAt: string;
}

export async function insertWarning(db: D1Database, w: NewWarning): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_warnings (id, user_id, reason_code, note, report_id, entity_kind, entity_id, issued_by, issued_by_name, created_at, locale, in_app_sent, email_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
    )
    .bind(w.id, w.userId, w.reasonCode, w.note ?? null, w.reportId ?? null, w.entityKind ?? null, w.entityId ?? null, w.issuedBy, w.issuedByName, w.createdAt, w.locale)
    .run();
}

export async function getWarning(db: D1Database, id: string): Promise<WarningRow | null> {
  return db.prepare('SELECT * FROM user_warnings WHERE id = ?').bind(id).first<WarningRow>();
}

export async function countWarnings(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM user_warnings WHERE user_id = ?').bind(userId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** Warning counts of several users (users without warnings are 0). */
export async function warningCounts(db: D1Database, userIds: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const counts = new Map(unique.map((id) => [id, 0]));
  if (unique.length === 0) return counts;
  const { results = [] } = await db
    .prepare('SELECT user_id, COUNT(*) AS n FROM user_warnings WHERE user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id')
    .bind(JSON.stringify(unique))
    .all<{ user_id: string; n: number }>();
  for (const r of results) counts.set(r.user_id, Number(r.n));
  return counts;
}

/** The user's warnings, newest first, each with its place in the history. */
export async function listWarnings(db: D1Database, userId: string, limit = WARNING_HISTORY_MAX): Promise<Omit<UserWarningList, 'emailLanguage'>> {
  const [count, { results = [] }] = await Promise.all([
    countWarnings(db, userId),
    db
      .prepare('SELECT * FROM user_warnings WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .bind(userId, Math.min(Math.max(1, limit), WARNING_HISTORY_MAX))
      .all<WarningRow>(),
  ]);
  return { items: results.map((row, i) => toWarning(row, count - i)), count, suggestBan: warningEscalation(count).suggestBan };
}

export async function markInAppSent(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE user_warnings SET in_app_sent = 1 WHERE id = ?').bind(id).run();
}

export async function recordWarningEmail(db: D1Database, id: string, status: UserWarningEmailStatus, opts: { error?: string; now?: Date } = {}): Promise<void> {
  await db
    .prepare('UPDATE user_warnings SET email_status = ?, email_error = ?, email_updated_at = ? WHERE id = ?')
    .bind(status, opts.error?.slice(0, 500) ?? null, (opts.now ?? new Date()).toISOString(), id)
    .run();
}
