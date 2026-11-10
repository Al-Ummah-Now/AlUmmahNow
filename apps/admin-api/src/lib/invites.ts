/**
 * Invited creators (docs/admin/INVITES.md): the local mirror (REPORTS_DB
 * creator_invites, migration 0014) and its queue to auth.
 *
 *   POST /api/invites ──▶ ids minted here; videos profile, tier, channels now
 *                         ──▶ row 'sending' ──▶ queue { type: 'invite', op: 'create' }
 *       ok                       → 'sent' (+ auth's status, expiry, email sent)
 *       permanent error (4xx)    → 'failed', flagged (Retry); 409 user_exists says who
 *       transient error          → retried with the queue's backoff, then 'failed'
 *   resend / link / revoke / restore / purge ──▶ pending_op ──▶ { op } ──▶ auth
 *   cron (every 5 min)          ──▶ { op: 'sync' } for open invites (accepted? expired?)
 *
 * It shares the auth-moderation-requests queue and client (the videos admin's
 * auth client, which holds the invites:provision scope). Nothing talks to auth
 * inside an admin's request.
 */
import { logger } from './logger';
import type { D1Database } from './types';
import { AuthApiError, AuthModerationClient, audit, isPermanentAuthError } from './authModeration';

export type InviteRole = 'creator' | 'viewer';
export type InviteDelivery = 'sending' | 'sent' | 'failed';
export type InviteAuthStatus = 'invited' | 'active' | 'expired' | 'revoked';
export type InviteOp = 'create' | 'resend' | 'link' | 'revoke' | 'restore' | 'purge' | 'sync';
export type InviteMessage = { type: 'invite'; id: string; op: InviteOp; args?: Record<string, unknown> };

export const INVITE_RETENTION_DAYS = 30;
/** Auth roles an invite may add (auth's INVITE_GRANTABLE_ROLES). */
export const INVITE_AUTH_ROLES = ['Scholar'] as const;
export const DEFAULT_INVITE_DAYS = 14;
export const MAX_INVITE_DAYS = 90;
/** Invite changes (create, resend, link, revoke…) one admin may make per hour. */
export const INVITE_ACTIONS_PER_HOUR = 60;
const MAX_ATTEMPTS = 7;

export interface InviteChannel {
  id: string;
  name: string;
  handle?: string | null;
  action: 'created' | 'transferred';
  jobId?: string | null;
}

export interface InviteRow {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  locale: string;
  note: string | null;
  role: InviteRole;
  tier_id: string | null;
  auth_roles: string;
  channels: string;
  expires_in_days: number;
  continue_url: string | null;
  delivery_status: InviteDelivery;
  delivery_attempts: number;
  delivery_error: string | null;
  email_sent: number;
  status: InviteAuthStatus | null;
  expires_at: string | null;
  accepted_at: string | null;
  last_sent_at: string | null;
  send_count: number;
  pending_op: string | null;
  op_error: string | null;
  sync_requested_at: string | null;
  synced_at: string | null;
  created_by: string;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_reason: string | null;
  purge_requested_at: string | null;
}

/** What admin-web shows: the status the admin acts on. */
export type InviteListStatus = 'sending' | 'failed' | InviteAuthStatus;

export interface InviteView {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  locale: 'en' | 'ar';
  note: string | null;
  role: InviteRole;
  tierId: string | null;
  authRoles: string[];
  channels: InviteChannel[];
  status: InviteListStatus;
  delivery: InviteDelivery;
  deliveryError: string | null;
  emailSent: boolean;
  expiresAt: string | null;
  acceptedAt: string | null;
  lastSentAt: string | null;
  sendCount: number;
  pendingOp: string | null;
  opError: string | null;
  createdBy: string;
  createdByEmail: string | null;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  deletedReason: string | null;
  purgeRequestedAt: string | null;
  /** Revoked: when it is purged (30 days after the revoke; queued: the cleanup's next run). */
  purgeAfter: string | null;
}

const hex = () => crypto.randomUUID().replace(/-/g, '');
export const newUserId = () => `usr_${hex()}`;
export const newInviteId = () => `inv_${hex()}`;
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
/** One @, something before it, a dotted domain after it, no spaces; linear time (no backtracking regex). */
export function isEmailAddress(value: string): boolean {
  if (value.length > 254 || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}
const errorText = (error: unknown) => (error instanceof AuthApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error));

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function statusOf(row: InviteRow, now = Date.now()): InviteListStatus {
  if (row.deleted_at) return 'revoked';
  if (row.delivery_status === 'failed') return 'failed';
  if (row.delivery_status === 'sending') return 'sending';
  if (row.accepted_at || row.status === 'active') return 'active';
  if (row.status === 'revoked') return 'revoked';
  if (row.expires_at && Date.parse(row.expires_at) <= now) return 'expired';
  return row.status ?? 'invited';
}

export function toView(row: InviteRow, now = Date.now()): InviteView {
  const purgeAfter = row.deleted_at
    ? row.purge_requested_at ?? new Date(Date.parse(row.deleted_at) + INVITE_RETENTION_DAYS * 86_400_000).toISOString()
    : null;
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    locale: row.locale === 'ar' ? 'ar' : 'en',
    note: row.note,
    role: row.role,
    tierId: row.tier_id,
    authRoles: parseJson<string[]>(row.auth_roles, []),
    channels: parseJson<InviteChannel[]>(row.channels, []),
    status: statusOf(row, now),
    delivery: row.delivery_status,
    deliveryError: row.delivery_error,
    emailSent: row.email_sent === 1,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    lastSentAt: row.last_sent_at,
    sendCount: row.send_count,
    pendingOp: row.pending_op ? parseJson<{ op: string }>(row.pending_op, { op: '' }).op || null : null,
    opError: row.op_error,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deletedReason: row.deleted_reason,
    purgeRequestedAt: row.purge_requested_at,
    purgeAfter,
  };
}

export async function getInvite(db: D1Database, id: string): Promise<InviteRow | null> {
  return db.prepare('SELECT * FROM creator_invites WHERE id = ?').bind(id).first<InviteRow>();
}

export async function inviteForUser(db: D1Database, userId: string): Promise<InviteRow | null> {
  return db.prepare('SELECT * FROM creator_invites WHERE user_id = ?').bind(userId).first<InviteRow>();
}

/** The open (not revoked) invite of an email, if any. */
export async function liveInviteForEmail(db: D1Database, email: string): Promise<InviteRow | null> {
  return db.prepare('SELECT * FROM creator_invites WHERE email = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1').bind(normalizeEmail(email)).first<InviteRow>();
}

/** Invite status per user id (user lists show an "Invited" badge). */
export async function inviteStatusByUser(db: D1Database, userIds: string[], now = Date.now()): Promise<Map<string, { id: string; status: InviteListStatus }>> {
  const out = new Map<string, { id: string; status: InviteListStatus }>();
  const ids = [...new Set(userIds)].slice(0, 200);
  if (!ids.length) return out;
  const { results } = await db
    .prepare(`SELECT * FROM creator_invites WHERE user_id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids))
    .all<InviteRow>();
  for (const row of results ?? []) out.set(row.user_id, { id: row.id, status: statusOf(row, now) });
  return out;
}

export interface ListParams {
  status?: InviteListStatus;
  q?: string;
  cursor?: string;
  limit?: number;
}

export async function listInvites(db: D1Database, params: ListParams, now = Date.now()): Promise<{ items: InviteView[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const where: string[] = [];
  const binds: unknown[] = [];
  const nowIso = new Date(now).toISOString();
  switch (params.status) {
    case 'revoked':
      where.push("(deleted_at IS NOT NULL OR status = 'revoked')");
      break;
    case 'failed':
    case 'sending':
      where.push('deleted_at IS NULL AND delivery_status = ?');
      binds.push(params.status);
      break;
    case 'active':
      where.push("deleted_at IS NULL AND delivery_status = 'sent' AND (accepted_at IS NOT NULL OR status = 'active')");
      break;
    case 'expired':
      where.push("deleted_at IS NULL AND delivery_status = 'sent' AND accepted_at IS NULL AND COALESCE(status, '') NOT IN ('active', 'revoked') AND expires_at <= ?");
      binds.push(nowIso);
      break;
    case 'invited':
      where.push("deleted_at IS NULL AND delivery_status = 'sent' AND accepted_at IS NULL AND COALESCE(status, 'invited') = 'invited' AND (expires_at IS NULL OR expires_at > ?)");
      binds.push(nowIso);
      break;
  }
  const q = params.q?.trim().toLowerCase();
  if (q) {
    where.push("(email LIKE ? ESCAPE '\\' OR lower(COALESCE(name, '')) LIKE ? ESCAPE '\\' OR id = ? OR user_id = ?)");
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    binds.push(like, like, params.q!.trim(), params.q!.trim());
  }
  if (params.cursor) {
    const [at, id] = params.cursor.split('|');
    if (at && id) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      binds.push(at, at, id);
    }
  }
  const { results } = await db
    .prepare(`SELECT * FROM creator_invites ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...binds, limit + 1)
    .all<InviteRow>();
  const rows = results ?? [];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page.map((r) => toView(r, now)), nextCursor: rows.length > limit && last ? `${last.created_at}|${last.id}` : null };
}

/** Invite actions this admin made in the last hour (admin_audit_log). */
export async function recentInviteActions(db: D1Database, actorId: string, now = Date.now()): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE actor_id = ? AND action LIKE 'invite.%' AND created_at >= ?")
    .bind(actorId, new Date(now - 3_600_000).toISOString())
    .first<{ n: number }>();
  return Number(row?.n) || 0;
}

export interface NewInvite {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  locale: 'en' | 'ar';
  note: string | null;
  role: InviteRole;
  tierId: string | null;
  authRoles: string[];
  expiresInDays: number;
  continueUrl: string | null;
  createdBy: string;
  createdByEmail: string | null;
}

export async function insertInvite(db: D1Database, input: NewInvite, now = new Date().toISOString()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO creator_invites (id, user_id, email, name, locale, note, role, tier_id, auth_roles, channels, expires_in_days, continue_url,
         delivery_status, created_by, created_by_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 'sending', ?, ?, ?, ?)`
    )
    .bind(input.id, input.userId, input.email, input.name, input.locale, input.note, input.role, input.tierId, JSON.stringify(input.authRoles), input.expiresInDays, input.continueUrl, input.createdBy, input.createdByEmail, now, now)
    .run();
}

export async function addChannels(db: D1Database, id: string, channels: InviteChannel[]): Promise<void> {
  const row = await getInvite(db, id);
  if (!row) return;
  const merged = [...parseJson<InviteChannel[]>(row.channels, []), ...channels];
  await db.prepare('UPDATE creator_invites SET channels = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(merged), new Date().toISOString(), id).run();
}

export async function setPendingOp(db: D1Database, id: string, op: InviteOp, args: Record<string, unknown> = {}): Promise<void> {
  await db
    .prepare('UPDATE creator_invites SET pending_op = ?, op_error = NULL, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify({ op, args }), new Date().toISOString(), id)
    .run();
}

export async function enqueue(env: InviteQueueEnv, id: string, op: InviteOp, args?: Record<string, unknown>): Promise<boolean> {
  try {
    if (!env.AUTH_REQUESTS_QUEUE) throw new Error('The auth-moderation-requests queue is not configured (AUTH_REQUESTS_QUEUE)');
    await env.AUTH_REQUESTS_QUEUE.send({ type: 'invite', id, op, ...(args ? { args } : {}) }, { contentType: 'json' });
    return true;
  } catch (error) {
    const message = `Could not queue the change: ${errorText(error)}`;
    if (op === 'create') await markDelivery(env.REPORTS_DB, id, 'failed', 0, message);
    else await env.REPORTS_DB.prepare('UPDATE creator_invites SET op_error = ?, updated_at = ? WHERE id = ?').bind(message, new Date().toISOString(), id).run();
    logger.error('[Invites] Queue send failed', { inviteId: id, op, error: errorText(error) });
    return false;
  }
}

async function markDelivery(db: D1Database, id: string, status: InviteDelivery, attempts: number, error: string | null): Promise<void> {
  await db
    .prepare('UPDATE creator_invites SET delivery_status = ?, delivery_attempts = ?, delivery_error = ?, updated_at = ? WHERE id = ?')
    .bind(status, attempts, error, new Date().toISOString(), id)
    .run();
}

/** Auth's view of an invite. */
export interface AuthInvite {
  id: string;
  userId: string;
  status: InviteAuthStatus;
  expiresAt: number;
  acceptedAt: number | null;
  lastSentAt: number | null;
  sendCount: number;
  deletedAt: number | null;
  purgeRequestedAt: number | null;
}

const iso = (ms: number | null | undefined) => (typeof ms === 'number' ? new Date(ms).toISOString() : null);

/** Copies auth's state into the mirror; true when the status changed. */
export async function applyAuthState(db: D1Database, row: InviteRow, invite: AuthInvite, extra: { emailSent?: boolean } = {}): Promise<boolean> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE creator_invites SET status = ?, expires_at = ?, accepted_at = ?, last_sent_at = ?, send_count = ?,
         email_sent = CASE WHEN ? THEN 1 ELSE email_sent END, synced_at = ?, updated_at = ? WHERE id = ?`
    )
    .bind(invite.status, iso(invite.expiresAt), iso(invite.acceptedAt), iso(invite.lastSentAt), invite.sendCount, extra.emailSent ? 1 : 0, now, now, row.id)
    .run();
  return row.status !== invite.status;
}

/** The invites part of the videos admin's auth client (scope invites:provision). */
export class AuthInviteClient extends AuthModerationClient {
  static override fromEnv(env: InviteQueueEnv, fetchImpl?: typeof fetch): AuthInviteClient {
    if (!env.Issuer || !env.AUTH_MODERATION_CLIENT_ID || !env.AUTH_MODERATION_CLIENT_SECRET) {
      throw new AuthApiError(503, 'not_configured', 'Requests to auth are not configured (Issuer, AUTH_MODERATION_CLIENT_ID, AUTH_MODERATION_CLIENT_SECRET)');
    }
    return new AuthInviteClient({ authUrl: env.Issuer, clientId: env.AUTH_MODERATION_CLIENT_ID, clientSecret: env.AUTH_MODERATION_CLIENT_SECRET, fetch: fetchImpl });
  }

  async createInvite(body: Record<string, unknown>): Promise<{ invite: AuthInvite; emailSent: boolean }> {
    return (await this.call<{ invite: AuthInvite; emailSent: boolean }>('POST', '/provisioning/invites', body)).data;
  }

  async inviteOp(id: string, op: 'resend' | 'link' | 'revoke' | 'restore' | 'purge', body: Record<string, unknown>): Promise<{ invite: AuthInvite; emailSent?: boolean }> {
    return (await this.call<{ invite: AuthInvite; emailSent?: boolean }>('POST', `/provisioning/invites/${encodeURIComponent(id)}/${op}`, body)).data;
  }

  async invites(ids: string[]): Promise<AuthInvite[]> {
    return (await this.call<{ invites: AuthInvite[] }>('GET', `/provisioning/invites?ids=${ids.map(encodeURIComponent).join(',')}`)).data.invites;
  }
}

export interface InviteQueueEnv {
  REPORTS_DB: D1Database;
  AUTH_REQUESTS_QUEUE?: { send(body: unknown, options?: unknown): Promise<void>; sendBatch(batch: unknown[]): Promise<void> };
  Issuer?: string;
  AUTH_MODERATION_CLIENT_ID?: string;
  AUTH_MODERATION_CLIENT_SECRET?: string | { get(): Promise<string> };
}

export type Outcome = 'done' | 'retry' | 'failed' | 'skipped';

/** One queued invite change. */
export async function processInvite(env: InviteQueueEnv, msg: InviteMessage, attempt: number, client?: AuthInviteClient): Promise<Outcome> {
  const db = env.REPORTS_DB;
  const row = await getInvite(db, msg.id);
  if (!row) return 'skipped';
  const auth = () => client ?? AuthInviteClient.fromEnv(env);
  try {
    if (msg.op === 'create') {
      if (row.delivery_status !== 'sending') return 'skipped';
      // Revoked before auth had it: nothing to make (a restore queues the create again)
      if (row.deleted_at) {
        await markDelivery(db, row.id, 'failed', attempt, 'Revoked before the account was created');
        return 'done';
      }
      const { invite, emailSent } = await auth().createInvite({
        inviteId: row.id,
        userId: row.user_id,
        email: row.email,
        name: row.name,
        locale: row.locale,
        note: row.note,
        expiresInDays: row.expires_in_days,
        continueUrl: row.continue_url,
        roles: parseJson<string[]>(row.auth_roles, []),
        details: { role: row.role, tierId: row.tier_id, channels: parseJson(row.channels, []) },
        actor: { id: row.created_by, email: row.created_by_email },
      });
      await markDelivery(db, row.id, 'sent', attempt, null);
      await applyAuthState(db, row, invite, { emailSent });
      await audit(db, { actorId: 'queue', action: 'invite.sent', targetType: 'user', targetId: row.user_id, metadata: { inviteId: row.id, emailSent, attempts: attempt } });
      return 'done';
    }
    if (msg.op === 'sync') {
      if (row.delivery_status !== 'sent') return 'skipped';
      const [invite] = await auth().invites([row.id]);
      if (invite && (await applyAuthState(db, row, invite))) {
        await audit(db, { actorId: 'auth', action: `invite.${invite.status}`, targetType: 'user', targetId: row.user_id, metadata: { inviteId: row.id, from: row.status, to: invite.status } });
      }
      return 'done';
    }
    // Each message carries its own change (two quick clicks are two changes); pending_op is the latest, for display and Retry
    const pending = parseJson<{ op: string; args?: Record<string, unknown> }>(row.pending_op, { op: '' });
    const args = msg.args ?? (pending.op === msg.op ? pending.args : undefined) ?? {};
    const clearPending = () =>
      db.prepare("UPDATE creator_invites SET pending_op = NULL, op_error = NULL WHERE id = ? AND json_extract(pending_op, '$.op') = ?").bind(row.id, msg.op).run();
    if (row.delivery_status !== 'sent') {
      // The account is not in auth yet: nothing there to change; the create carries the state
      await clearPending();
      return 'done';
    }
    const result = await auth().inviteOp(row.id, msg.op as 'resend', args);
    await clearPending();
    await applyAuthState(db, row, result.invite, { emailSent: result.emailSent });
    return 'done';
  } catch (error) {
    const message = errorText(error);
    const final = isPermanentAuthError(error) || attempt >= MAX_ATTEMPTS;
    if (msg.op === 'create') {
      await markDelivery(db, row.id, final ? 'failed' : 'sending', attempt, message);
      if (final) {
        await audit(db, { actorId: 'queue', action: 'invite.failed', targetType: 'user', targetId: row.user_id, metadata: { inviteId: row.id, error: message, needsAttention: true } });
        logger.warn('[Invites] Account not created in auth', { inviteId: row.id, attempts: attempt, error: message });
      }
    } else if (final && msg.op !== 'sync') {
      await db.prepare('UPDATE creator_invites SET op_error = ?, updated_at = ? WHERE id = ?').bind(`${msg.op}: ${message}`, new Date().toISOString(), row.id).run();
      await audit(db, { actorId: 'queue', action: 'invite.op_failed', targetType: 'user', targetId: row.user_id, metadata: { inviteId: row.id, op: msg.op, error: message, needsAttention: true } });
    }
    return final ? 'failed' : 'retry';
  }
}

/** Cron: status reads for open invites (not accepted, not revoked), oldest read first. */
export async function scheduleInviteSyncs(env: InviteQueueEnv, now = Date.now()): Promise<number> {
  if (!env.AUTH_REQUESTS_QUEUE) return 0;
  const { results } = await env.REPORTS_DB.prepare(
    `SELECT id FROM creator_invites
     WHERE delivery_status = 'sent' AND deleted_at IS NULL AND accepted_at IS NULL AND COALESCE(status, 'invited') IN ('invited', 'expired')
       AND (sync_requested_at IS NULL OR sync_requested_at < ?)
     ORDER BY COALESCE(synced_at, created_at) ASC LIMIT 100`
  )
    .bind(new Date(now - 60_000).toISOString())
    .all<{ id: string }>();
  const ids = (results ?? []).map((r) => r.id);
  if (!ids.length) return 0;
  const at = new Date(now).toISOString();
  await env.REPORTS_DB.prepare('UPDATE creator_invites SET sync_requested_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(at, JSON.stringify(ids)).run();
  await env.AUTH_REQUESTS_QUEUE.sendBatch(ids.map((id) => ({ body: { type: 'invite', id, op: 'sync' }, contentType: 'json' })));
  return ids.length;
}

/** An open invite's status is read again at most this often when an admin looks at it. */
export const READ_SYNC_INTERVAL_MS = 15_000;

/**
 * Reads ask too: when an admin opens an invite, the invites list or an invited
 * user's page, each open invite shown gets a status read through the queue
 * (at most every READ_SYNC_INTERVAL_MS), so "Signed in" shows within seconds of
 * the first sign-in instead of waiting for the 5-minute cron. Still no call to
 * auth inside the request: only a queue message. Never fails the read.
 */
export async function syncInvitesOnRead(env: InviteQueueEnv, ids: string[], now = Date.now()): Promise<number> {
  const wanted = [...new Set(ids)].slice(0, 100);
  if (!env.AUTH_REQUESTS_QUEUE || !wanted.length) return 0;
  try {
    const { results } = await env.REPORTS_DB.prepare(
      `SELECT id FROM creator_invites
       WHERE id IN (SELECT value FROM json_each(?))
         AND delivery_status = 'sent' AND deleted_at IS NULL AND accepted_at IS NULL AND COALESCE(status, 'invited') IN ('invited', 'expired')
         AND (sync_requested_at IS NULL OR sync_requested_at < ?)`
    )
      .bind(JSON.stringify(wanted), new Date(now - READ_SYNC_INTERVAL_MS).toISOString())
      .all<{ id: string }>();
    const due = (results ?? []).map((r) => r.id);
    if (!due.length) return 0;
    await env.REPORTS_DB.prepare('UPDATE creator_invites SET sync_requested_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(new Date(now).toISOString(), JSON.stringify(due)).run();
    await env.AUTH_REQUESTS_QUEUE.sendBatch(due.map((id) => ({ body: { type: 'invite', id, op: 'sync' }, contentType: 'json' })));
    return due.length;
  } catch (error) {
    logger.warn('[Invites] Status read on view not queued', { count: wanted.length, error: errorText(error) });
    return 0;
  }
}

/** The DLQ: the handler kept failing. */
export async function deadLetterInvite(env: InviteQueueEnv, msg: InviteMessage): Promise<void> {
  const row = await getInvite(env.REPORTS_DB, msg.id);
  if (!row) return;
  if (msg.op === 'create' && row.delivery_status === 'sending') {
    await markDelivery(env.REPORTS_DB, row.id, 'failed', row.delivery_attempts, row.delivery_error ?? 'Could not be sent after every retry');
  } else if (msg.op !== 'sync' && row.pending_op) {
    await env.REPORTS_DB.prepare('UPDATE creator_invites SET op_error = ? WHERE id = ?').bind(`${msg.op}: not delivered after every retry`, row.id).run();
  }
}

/** Who acted on an invite (sent to auth with each change). */
export interface InviteActorRef {
  id: string;
  email: string | null;
}

export class InviteStateError extends Error {
  constructor(readonly status: 404 | 409, readonly code: string, message: string, readonly invite?: InviteView) {
    super(message);
  }
}

async function queueChange(env: InviteQueueEnv, row: InviteRow, op: Exclude<InviteOp, 'create' | 'sync'>, args: Record<string, unknown>, actor: InviteActorRef) {
  const withActor = { ...args, actor };
  await setPendingOp(env.REPORTS_DB, row.id, op, withActor);
  await enqueue(env, row.id, op, withActor);
}

/**
 * Undo a revoke (the invites list, or Recently deleted): the invite and its
 * account come back in auth; revoked before auth had it, it is created now.
 */
export async function restoreInvite(env: InviteQueueEnv, row: InviteRow, actor: InviteActorRef): Promise<void> {
  if (!row.deleted_at) return;
  const other = await liveInviteForEmail(env.REPORTS_DB, row.email);
  if (other) throw new InviteStateError(409, 'email_taken', 'Another open invite uses this email', toView(other));
  const now = new Date().toISOString();
  await env.REPORTS_DB.prepare('UPDATE creator_invites SET deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL, purge_requested_at = NULL, updated_at = ? WHERE id = ?').bind(now, row.id).run();
  if (row.delivery_status === 'sent') await queueChange(env, row, 'restore', {}, actor);
  else {
    await env.REPORTS_DB.prepare("UPDATE creator_invites SET delivery_status = 'sending', delivery_error = NULL WHERE id = ?").bind(row.id).run();
    await enqueue(env, row.id, 'create');
  }
}

/** "Delete permanently now": queues the revoked invite (and its auth account) for the cleanups' next run. */
export async function requestInvitePurge(env: InviteQueueEnv, row: InviteRow, actor: InviteActorRef): Promise<void> {
  if (!row.deleted_at) throw new InviteStateError(409, 'not_revoked', 'Revoke the invite first');
  const now = new Date().toISOString();
  await env.REPORTS_DB.prepare('UPDATE creator_invites SET purge_requested_at = COALESCE(purge_requested_at, ?), updated_at = ? WHERE id = ?').bind(now, now, row.id).run();
  if (row.delivery_status === 'sent') await queueChange(env, row, 'purge', { confirm: row.email }, actor);
}

/** Revoked invites, for Recently deleted (newest first). */
export async function listRevokedInvites(db: D1Database, limit = 500): Promise<InviteRow[]> {
  const { results } = await db.prepare('SELECT * FROM creator_invites WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?').bind(limit).all<InviteRow>();
  return results ?? [];
}

/**
 * The hourly trash cleanup's part: drops the mirror of revoked invites past
 * their 30 days, or queued for permanent deletion once auth has that request
 * (no change still pending). Auth removes the account on its own cleanup.
 */
export async function purgeRevokedInviteMirrors(db: D1Database, cutoff: string, limit: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT id FROM creator_invites WHERE deleted_at IS NOT NULL
         AND (deleted_at <= ? OR (purge_requested_at IS NOT NULL AND (pending_op IS NULL OR delivery_status != 'sent')))
       ORDER BY deleted_at LIMIT ?`
    )
    .bind(cutoff, limit)
    .all<{ id: string }>();
  const ids = (results ?? []).map((r) => r.id);
  for (const id of ids) await db.prepare('DELETE FROM creator_invites WHERE id = ? AND deleted_at IS NOT NULL').bind(id).run();
  return ids;
}

/** A SHA-256 hex digest (the "copy link" token goes to auth only as this). */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newLinkToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Where the invite's "Continue" goes: the videos web app's sign-in, landing on
 * the home page in the invite's language. VIDEOS_WEB_URL if set, else the
 * admin host with admin. → videos. (admin.qa.alummahnow.net → videos.qa…).
 */
export function signInUrl(env: { VIDEOS_WEB_URL?: string; ADMIN_WEB_URL?: string }, locale: 'en' | 'ar'): string | null {
  let base = env.VIDEOS_WEB_URL;
  if (!base && env.ADMIN_WEB_URL) {
    try {
      const url = new URL(env.ADMIN_WEB_URL);
      if (url.hostname.startsWith('admin.')) base = `${url.protocol}//videos.${url.hostname.slice('admin.'.length)}`;
    } catch {
      base = undefined;
    }
  }
  if (!base) return null;
  const url = new URL('/api/auth/login', base);
  url.searchParams.set('prompt', 'login');
  url.searchParams.set('locale', locale);
  url.searchParams.set('return', `/${locale}`);
  return url.toString();
}
