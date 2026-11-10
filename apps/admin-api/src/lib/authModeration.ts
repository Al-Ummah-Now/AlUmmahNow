/**
 * Moderation requests to auth (docs/admin/AUTH_MODERATION_REQUESTS.md).
 *
 * Videos admins manage videos users here. When the auth identity itself needs
 * action they ASK auth: the admin API files a request with auth's client API
 * (AlUmmahNowAuth docs/MODERATION_REQUESTS.md) as the videos admin's OAuth client
 * (HTTP Basic client_id:client_secret), and polls its status. Auth admins decide.
 *
 * No Workers-only imports: unit tested with node:test.
 */
import { z } from 'zod';
import type { D1Database } from './types';

export const AUTH_REQUEST_ACTIONS = ['suspend_account', 'delete_account', 'revoke_sessions', 'require_password_reset', 'other'] as const;
export const AUTH_REQUEST_REASONS = [
  'spam',
  'harassment',
  'hate_speech',
  'violent_content',
  'sexual_content',
  'impersonation',
  'copyright',
  'fraud',
  'compromised_account',
  'other',
] as const;
export const AUTH_REQUEST_STATUSES = ['pending', 'info_requested', 'approved', 'rejected', 'actioned'] as const;
export type AuthRequestStatus = (typeof AUTH_REQUEST_STATUSES)[number];

export const isFinalStatus = (s: string) => s === 'rejected' || s === 'actioned';

const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
    } catch {
      return false;
    }
  }, 'must be an https URL');

export const EvidenceSchema = z.object({ url: httpsUrl, label: z.string().trim().max(200).optional() });
export type Evidence = z.infer<typeof EvidenceSchema>;

/** What the admin web sends to POST /api/auth-requests. */
export const SubmitSchema = z.object({
  subject_user_id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/, 'must be an auth user id'),
  action: z.enum(AUTH_REQUEST_ACTIONS),
  reason_category: z.enum(AUTH_REQUEST_REASONS),
  reason: z.string().trim().min(1, 'reason is required').max(2000),
  note: z.string().trim().max(1800).optional(),
  evidence: z.array(EvidenceSchema).max(10).optional(),
  report_ids: z.array(z.string().trim().min(1).max(128)).max(20).optional(),
  idempotency_key: z.string().trim().min(8).max(128).optional(),
});
export type Submission = z.infer<typeof SubmitSchema>;

export const ProvideInfoSchema = z.object({
  note: z.string().trim().min(1, 'note is required').max(4000),
  evidence: z.array(EvidenceSchema).max(10).optional(),
});

/** The reason auth sees: the category's text plus the admin's note. */
export function composeReason(reason: string, note?: string): string {
  return note ? `${reason}\n\nNote: ${note}` : reason;
}

/**
 * Evidence attached to every request: the user's page in the videos admin, the
 * reports on content the user owns, then anything the admin added. Deduplicated,
 * at most 20 (auth's limit).
 */
export function buildEvidence(opts: { adminWebUrl?: string; subjectUserId: string; reportIds?: string[]; extra?: Evidence[] }): Evidence[] {
  const out: Evidence[] = [];
  const base = (opts.adminWebUrl || '').replace(/\/+$/, '');
  if (base) {
    out.push({ url: `${base}/users/${encodeURIComponent(opts.subjectUserId)}`, label: 'Videos admin: user page' });
    for (const id of opts.reportIds ?? []) out.push({ url: `${base}/moderation/reports/${encodeURIComponent(id)}`, label: `Videos admin: report ${id}` });
  }
  for (const e of opts.extra ?? []) out.push(e);
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.url) ? false : (seen.add(e.url), true))).slice(0, 20);
}

/** Reports (newest first, at most `limit`) on content the user owns, from the search index's ownership table. */
export async function reportsOnUserContent(
  reports: D1Database | undefined,
  search: D1Database | undefined,
  userId: string,
  limit = 10
): Promise<Array<{ id: string; entity_type: string; entity_id: string; reason: string; status: string }>> {
  if (!reports || !search) return [];
  const { results: owned } = await search
    .prepare('SELECT kind, id FROM content_ownership WHERE owner_id = ? LIMIT 200')
    .bind(userId)
    .all<{ kind: string; id: string }>();
  const items = owned ?? [];
  if (!items.length) return [];
  const found: Array<{ id: string; entity_type: string; entity_id: string; reason: string; status: string; created_at: string }> = [];
  // D1 caps bound parameters per statement: query in chunks
  for (let i = 0; i < items.length; i += 40) {
    const chunk = items.slice(i, i + 40);
    const where = chunk.map(() => '(entity_type = ? AND entity_id = ?)').join(' OR ');
    const { results } = await reports
      .prepare(`SELECT id, entity_type, entity_id, reason, status, created_at FROM reports WHERE ${where} ORDER BY created_at DESC LIMIT ?`)
      .bind(...chunk.flatMap((c) => [c.kind, c.id]), limit)
      .all<{ id: string; entity_type: string; entity_id: string; reason: string; status: string; created_at: string }>();
    found.push(...(results ?? []));
  }
  return found
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit)
    .map(({ created_at: _created, ...r }) => r);
}

// ---------------------------------------------------------------------------
// Auth client API
// ---------------------------------------------------------------------------

export interface AuthRequest {
  id: string;
  status: AuthRequestStatus;
  subject_user_id: string;
  action: string;
  reason_category: string;
  reason: string;
  evidence: Evidence[];
  requested_by: { id: string; display_name: string };
  decision_note: string | null;
  decided_at: string | null;
  actioned_at: string | null;
  created_at: string;
  updated_at: string;
  history: Array<{ type: string; by: string; note: string | null; at: string }>;
}

export class AuthApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly body?: unknown) {
    super(message);
  }
}

type SecretValue = string | { get(): Promise<string> } | undefined;

export interface AuthModerationConfig {
  authUrl: string;
  clientId: string;
  clientSecret: SecretValue;
  fetch?: typeof fetch;
}

async function readSecret(value: SecretValue): Promise<string> {
  if (!value) return '';
  return typeof value === 'string' ? value : await value.get();
}

export class AuthModerationClient {
  private readonly doFetch: typeof fetch;
  constructor(private readonly config: AuthModerationConfig) {
    this.doFetch = config.fetch ?? ((...args) => fetch(...args));
  }

  static fromEnv(env: { Issuer?: string; AUTH_MODERATION_CLIENT_ID?: string; AUTH_MODERATION_CLIENT_SECRET?: SecretValue }, fetchImpl?: typeof fetch) {
    if (!env.Issuer || !env.AUTH_MODERATION_CLIENT_ID || !env.AUTH_MODERATION_CLIENT_SECRET) {
      throw new AuthApiError(503, 'not_configured', 'Requests to auth are not configured (Issuer, AUTH_MODERATION_CLIENT_ID, AUTH_MODERATION_CLIENT_SECRET)');
    }
    return new AuthModerationClient({ authUrl: env.Issuer, clientId: env.AUTH_MODERATION_CLIENT_ID, clientSecret: env.AUTH_MODERATION_CLIENT_SECRET, fetch: fetchImpl });
  }

  protected async call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
    const secret = await readSecret(this.config.clientSecret);
    const url = new URL(path, this.config.authUrl);
    let res: Response;
    try {
      res = await this.doFetch(url.toString(), {
        method,
        headers: {
          Authorization: `Basic ${btoa(`${this.config.clientId}:${secret}`)}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new AuthApiError(502, 'auth_unreachable', `Auth is unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = typeof data.error === 'string' ? data.error : 'auth_error';
      const message = typeof data.error_description === 'string' ? data.error_description : code;
      // Our own credentials being refused is a server problem, not the admin's
      const status = res.status === 401 || res.status === 403 ? 502 : res.status;
      throw new AuthApiError(status, code, message, data);
    }
    return { status: res.status, data: data as T };
  }

  async create(payload: {
    subject_user_id: string;
    action: string;
    reason_category: string;
    reason: string;
    evidence: Evidence[];
    requested_by: { id: string; display_name: string };
  }, idempotencyKey: string): Promise<{ request: AuthRequest; replayed: boolean }> {
    const { status, data } = await this.call<{ request: AuthRequest }>('POST', '/moderation/requests', payload, { 'Idempotency-Key': idempotencyKey });
    return { request: data.request, replayed: status === 200 };
  }

  async get(id: string): Promise<AuthRequest> {
    return (await this.call<{ request: AuthRequest }>('GET', `/moderation/requests/${encodeURIComponent(id)}`)).data.request;
  }

  async provideInfo(id: string, body: { note: string; evidence?: Evidence[]; requested_by: { id: string; display_name: string } }): Promise<AuthRequest> {
    return (await this.call<{ request: AuthRequest }>('POST', `/moderation/requests/${encodeURIComponent(id)}/info`, body)).data.request;
  }
}

// ---------------------------------------------------------------------------
// Local mirror and audit log (REPORTS_DB, migration 0011)
// ---------------------------------------------------------------------------

export type DeliveryStatus = 'sending' | 'sent' | 'failed';

export interface MirrorRow {
  id: string;
  auth_request_id: string | null;
  subject_user_id: string;
  action: string;
  reason_category: string;
  reason: string;
  evidence: string;
  requested_by_id: string;
  requested_by_name: string;
  idempotency_key: string;
  delivery_status: DeliveryStatus;
  delivery_attempts: number;
  delivery_error: string | null;
  status: string | null;
  decision_note: string | null;
  history: string;
  pending_info: string | null;
  sync_error: string | null;
  sync_requested_at: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(s: string | null, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function toView(row: MirrorRow) {
  return {
    id: row.id,
    authRequestId: row.auth_request_id,
    subjectUserId: row.subject_user_id,
    action: row.action,
    reasonCategory: row.reason_category,
    reason: row.reason,
    evidence: parseJson<Evidence[]>(row.evidence, []),
    requestedBy: { id: row.requested_by_id, name: row.requested_by_name },
    /** sending -> sent, or failed (flagged: a videos admin can retry) */
    delivery: { status: row.delivery_status, attempts: row.delivery_attempts, error: row.delivery_error },
    /** Auth's status once sent */
    status: row.status,
    decisionNote: row.decision_note,
    history: parseJson<AuthRequest['history']>(row.history, []),
    /** An answer to auth waiting in the queue */
    answerPending: !!row.pending_info,
    syncError: row.sync_error,
    syncedAt: row.synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export type AuthRequestView = ReturnType<typeof toView>;

export function newLocalId(): string {
  return `areq_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** What a send attempt posts to auth (rebuilt from the row on every attempt). */
export function payloadOf(row: MirrorRow) {
  return {
    subject_user_id: row.subject_user_id,
    action: row.action,
    reason_category: row.reason_category,
    reason: row.reason,
    evidence: parseJson<Evidence[]>(row.evidence, []),
    requested_by: { id: row.requested_by_id, display_name: row.requested_by_name },
  };
}

export async function insertSending(
  db: D1Database,
  row: Pick<MirrorRow, 'id' | 'subject_user_id' | 'action' | 'reason_category' | 'reason' | 'requested_by_id' | 'requested_by_name' | 'idempotency_key'> & { evidence: Evidence[] },
  now = new Date().toISOString()
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO auth_moderation_requests
       (id, subject_user_id, action, reason_category, reason, evidence, requested_by_id, requested_by_name, idempotency_key,
        delivery_status, delivery_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending', 0, ?, ?)`
    )
    .bind(row.id, row.subject_user_id, row.action, row.reason_category, row.reason, JSON.stringify(row.evidence), row.requested_by_id, row.requested_by_name, row.idempotency_key, now, now)
    .run();
  return !!(res as { meta?: { changes?: number } }).meta?.changes;
}

export async function getRow(db: D1Database, id: string): Promise<MirrorRow | null> {
  return db.prepare('SELECT * FROM auth_moderation_requests WHERE id = ?').bind(id).first<MirrorRow>();
}

export async function markSent(db: D1Database, id: string, request: AuthRequest, attempts: number, now = new Date().toISOString()) {
  await db
    .prepare(
      `UPDATE auth_moderation_requests SET delivery_status = 'sent', delivery_attempts = ?, delivery_error = NULL, auth_request_id = ?,
       status = ?, decision_note = ?, history = ?, evidence = ?, synced_at = ?, updated_at = ? WHERE id = ?`
    )
    .bind(attempts, request.id, request.status, request.decision_note, JSON.stringify(request.history ?? []), JSON.stringify(request.evidence ?? []), now, now, id)
    .run();
}

export async function markDelivery(db: D1Database, id: string, status: DeliveryStatus, attempts: number, error: string | null, now = new Date().toISOString()) {
  await db
    .prepare('UPDATE auth_moderation_requests SET delivery_status = ?, delivery_attempts = ?, delivery_error = ?, updated_at = ? WHERE id = ?')
    .bind(status, attempts, error, now, id)
    .run();
}

/** Updates the mirror from auth's current view; returns true when the status changed. */
export async function syncMirror(db: D1Database, row: MirrorRow, request: AuthRequest, now = new Date().toISOString()): Promise<boolean> {
  await db
    .prepare('UPDATE auth_moderation_requests SET status = ?, decision_note = ?, history = ?, evidence = ?, sync_error = NULL, synced_at = ?, updated_at = ? WHERE id = ?')
    .bind(request.status, request.decision_note, JSON.stringify(request.history ?? []), JSON.stringify(request.evidence ?? []), now, now, row.id)
    .run();
  return row.status !== request.status;
}

export async function markSyncError(db: D1Database, id: string, error: string, now = new Date().toISOString()) {
  await db.prepare('UPDATE auth_moderation_requests SET sync_error = ?, updated_at = ? WHERE id = ?').bind(error, now, id).run();
}

export async function audit(
  db: D1Database | undefined,
  entry: { actorId: string; actorEmail?: string | null; action: string; targetType: string; targetId: string; metadata?: Record<string, unknown> },
  now = new Date().toISOString()
): Promise<void> {
  if (!db) return;
  await db
    .prepare('INSERT INTO admin_audit_log (id, actor_id, actor_email, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), entry.actorId, entry.actorEmail ?? null, entry.action, entry.targetType, entry.targetId, entry.metadata ? JSON.stringify(entry.metadata) : null, now)
    .run();
}

/** Errors that will not go away by sending again (our request is wrong, or the user is gone). */
export function isPermanentAuthError(error: unknown): boolean {
  if (!(error instanceof AuthApiError)) return false;
  return error.status === 400 || error.status === 404 || error.status === 409 || error.status === 503;
}
