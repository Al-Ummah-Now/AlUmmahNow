/**
 * The auth-moderation-requests queue (docs/admin/AUTH_MODERATION_REQUESTS.md).
 * Nothing talks to auth inside an admin's request:
 *
 *   POST /api/auth-requests ──▶ row 'sending' ──▶ { type: 'send' }
 *       ok                       → 'sent' (+ auth's id and status)
 *       permanent error (4xx)    → 'failed' at once, flagged for a videos admin (Retry)
 *       transient error          → retried: 30 s doubling to 15 min, 6 retries, then 'failed'
 *   cron (every 5 min) / reads ──▶ { type: 'sync' } ──▶ auth's status into the mirror
 *       failing after its retries → sync_error (shown), next cron tries again
 *   POST /:id/info ──▶ pending_info ──▶ { type: 'info' } ──▶ auth (then a status read)
 *       failing after its retries → sync_error; the answer stays pending for Retry
 *   dead-letter queue (handler kept crashing) → send: 'failed'; sync/info: sync_error
 *
 * The same Idempotency-Key goes with every send attempt, so a retry after a
 * timeout never files the request twice in auth.
 */
import { logger } from './logger';
import { deadLetterInvite, processInvite, type AuthInviteClient, type InviteMessage, type InviteQueueEnv } from './invites';
import type { D1Database } from './types';
import {
  AuthApiError,
  AuthModerationClient,
  audit,
  getRow,
  isFinalStatus,
  isPermanentAuthError,
  markDelivery,
  markSent,
  markSyncError,
  payloadOf,
  syncMirror,
  type Evidence,
  type MirrorRow,
} from './authModeration';

export type AuthRequestMessage = { type: 'send'; id: string } | { type: 'sync'; id: string } | { type: 'info'; id: string };

export const MAX_ATTEMPTS = 7; // first try + max_retries 6 (wrangler config)

/** Backoff before retry n (1-based): 30 s doubling, at most 15 minutes. */
export function retryDelaySeconds(attempt: number): number {
  return Math.min(30 * 2 ** Math.max(attempt - 1, 0), 900);
}

/** A sync is queued at most this often per request (reads and the cron both ask). */
export const SYNC_INTERVAL_MS = 30_000;

export interface QueueEnv {
  REPORTS_DB: D1Database;
  AUTH_REQUESTS_QUEUE?: Queue<AuthRequestMessage>;
  Issuer?: string;
  AUTH_MODERATION_CLIENT_ID?: string;
  AUTH_MODERATION_CLIENT_SECRET?: string | { get(): Promise<string> };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Queues the send of a 'sending' row; without a queue the row is flagged at once. */
export async function enqueueSend(env: QueueEnv, row: Pick<MirrorRow, 'id' | 'subject_user_id'>, actorId: string): Promise<boolean> {
  try {
    if (!env.AUTH_REQUESTS_QUEUE) throw new Error('The auth-moderation-requests queue is not configured (AUTH_REQUESTS_QUEUE)');
    await env.AUTH_REQUESTS_QUEUE.send({ type: 'send', id: row.id }, { contentType: 'json' });
    return true;
  } catch (error) {
    await markDelivery(env.REPORTS_DB, row.id, 'failed', 0, `Could not queue the request: ${errorText(error)}`);
    await audit(env.REPORTS_DB, { actorId, action: 'auth_request.failed', targetType: 'user', targetId: row.subject_user_id, metadata: { requestId: row.id, error: errorText(error), needsAttention: true } });
    return false;
  }
}

/** Queues status reads for sent, open requests not read or queued in the last SYNC_INTERVAL_MS. Returns how many. */
export async function enqueueSyncs(env: QueueEnv, rows: MirrorRow[], now = Date.now()): Promise<number> {
  if (!env.AUTH_REQUESTS_QUEUE) return 0;
  const due = rows.filter(
    (r) =>
      r.delivery_status === 'sent' &&
      r.auth_request_id &&
      !isFinalStatus(r.status ?? '') &&
      (!r.sync_requested_at || now - Date.parse(r.sync_requested_at) >= SYNC_INTERVAL_MS)
  );
  if (!due.length) return 0;
  const at = new Date(now).toISOString();
  for (const r of due) {
    await env.REPORTS_DB.prepare('UPDATE auth_moderation_requests SET sync_requested_at = ? WHERE id = ?').bind(at, r.id).run();
  }
  await env.AUTH_REQUESTS_QUEUE.sendBatch(due.map((r) => ({ body: { type: 'sync' as const, id: r.id }, contentType: 'json' as const })));
  return due.length;
}

/** Cron: every open request gets a status read (oldest first, at most 100). */
export async function scheduleSyncs(env: QueueEnv, now = Date.now()): Promise<number> {
  const { results } = await env.REPORTS_DB.prepare(
    `SELECT * FROM auth_moderation_requests
     WHERE delivery_status = 'sent' AND (status IS NULL OR status NOT IN ('rejected', 'actioned'))
     ORDER BY COALESCE(synced_at, created_at) ASC LIMIT 100`
  ).all<MirrorRow>();
  return enqueueSyncs(env, results ?? [], now);
}

export type Outcome = 'done' | 'retry' | 'failed' | 'skipped';

export async function processSend(env: QueueEnv, id: string, attempt: number, client?: AuthModerationClient): Promise<Outcome> {
  const row = await getRow(env.REPORTS_DB, id);
  if (!row || row.delivery_status !== 'sending') return 'skipped';
  try {
    const { request } = await (client ?? AuthModerationClient.fromEnv(env)).create(payloadOf(row), row.idempotency_key);
    await markSent(env.REPORTS_DB, row.id, request, attempt);
    await audit(env.REPORTS_DB, { actorId: 'queue', action: 'auth_request.sent', targetType: 'user', targetId: row.subject_user_id, metadata: { requestId: row.id, authRequestId: request.id, attempts: attempt } });
    return 'done';
  } catch (error) {
    const message = error instanceof AuthApiError ? `${error.code}: ${error.message}` : errorText(error);
    if (isPermanentAuthError(error) || attempt >= MAX_ATTEMPTS) {
      await markDelivery(env.REPORTS_DB, row.id, 'failed', attempt, message);
      await audit(env.REPORTS_DB, { actorId: 'queue', action: 'auth_request.failed', targetType: 'user', targetId: row.subject_user_id, metadata: { requestId: row.id, attempts: attempt, error: message, needsAttention: true } });
      return 'failed';
    }
    await markDelivery(env.REPORTS_DB, row.id, 'sending', attempt, message);
    return 'retry';
  }
}

export async function processSync(env: QueueEnv, id: string, attempt: number, client?: AuthModerationClient): Promise<Outcome> {
  const row = await getRow(env.REPORTS_DB, id);
  if (!row || row.delivery_status !== 'sent' || !row.auth_request_id || isFinalStatus(row.status ?? '')) return 'skipped';
  try {
    const request = await (client ?? AuthModerationClient.fromEnv(env)).get(row.auth_request_id);
    if (await syncMirror(env.REPORTS_DB, row, request)) {
      await audit(env.REPORTS_DB, {
        actorId: 'auth',
        action: `auth_request.${request.status}`,
        targetType: 'user',
        targetId: row.subject_user_id,
        metadata: { requestId: row.id, from: row.status, to: request.status, decisionNote: request.decision_note },
      });
    }
    return 'done';
  } catch (error) {
    const message = error instanceof AuthApiError ? `${error.code}: ${error.message}` : errorText(error);
    if (isPermanentAuthError(error) || attempt >= MAX_ATTEMPTS) {
      await markSyncError(env.REPORTS_DB, row.id, message);
      return 'failed';
    }
    return 'retry';
  }
}

export async function processInfo(env: QueueEnv, id: string, attempt: number, client?: AuthModerationClient): Promise<Outcome> {
  const row = await getRow(env.REPORTS_DB, id);
  if (!row || !row.pending_info || !row.auth_request_id) return 'skipped';
  const answer = JSON.parse(row.pending_info) as { note: string; evidence: Evidence[]; requested_by: { id: string; display_name: string } };
  try {
    const request = await (client ?? AuthModerationClient.fromEnv(env)).provideInfo(row.auth_request_id, answer);
    await env.REPORTS_DB.prepare('UPDATE auth_moderation_requests SET pending_info = NULL WHERE id = ?').bind(row.id).run();
    await syncMirror(env.REPORTS_DB, row, request);
    await audit(env.REPORTS_DB, { actorId: answer.requested_by.id, action: 'auth_request.info_sent', targetType: 'user', targetId: row.subject_user_id, metadata: { requestId: row.id, attempts: attempt } });
    return 'done';
  } catch (error) {
    const message = error instanceof AuthApiError ? `${error.code}: ${error.message}` : errorText(error);
    // Auth no longer waits for an answer (decided meanwhile): drop it and read the status
    if (error instanceof AuthApiError && error.code === 'invalid_state') {
      await env.REPORTS_DB.prepare('UPDATE auth_moderation_requests SET pending_info = NULL, sync_requested_at = NULL WHERE id = ?').bind(row.id).run();
      return 'done';
    }
    if (isPermanentAuthError(error) || attempt >= MAX_ATTEMPTS) {
      await markSyncError(env.REPORTS_DB, row.id, `Answer not delivered: ${message}`);
      await audit(env.REPORTS_DB, { actorId: 'queue', action: 'auth_request.info_failed', targetType: 'user', targetId: row.subject_user_id, metadata: { requestId: row.id, error: message, needsAttention: true } });
      return 'failed';
    }
    return 'retry';
  }
}

/** The DLQ: the handler kept failing. Flag the send; note the sync error. */
export async function deadLetter(env: QueueEnv, body: AuthRequestMessage): Promise<void> {
  const row = await getRow(env.REPORTS_DB, body.id);
  if (!row) return;
  if (body.type === 'send' && row.delivery_status === 'sending') {
    await markDelivery(env.REPORTS_DB, row.id, 'failed', row.delivery_attempts, row.delivery_error ?? 'Could not be sent after every retry');
    await audit(env.REPORTS_DB, { actorId: 'queue', action: 'auth_request.failed', targetType: 'user', targetId: row.subject_user_id, metadata: { requestId: row.id, deadLetter: true, needsAttention: true } });
  } else if (body.type === 'sync') {
    await markSyncError(env.REPORTS_DB, row.id, 'Status read failed after every retry');
  } else if (body.type === 'info' && row.pending_info) {
    await markSyncError(env.REPORTS_DB, row.id, 'Answer not delivered after every retry');
  }
}

export function isDeadLetterQueue(name: string): boolean {
  return /-dlq(-[a-z]+)?$/.test(name);
}

const isInviteMessage = (body: unknown): body is InviteMessage =>
  !!body && typeof body === 'object' && (body as { type?: unknown }).type === 'invite' && typeof (body as { id?: unknown }).id === 'string';

export async function handleAuthRequestBatch(
  batch: MessageBatch<AuthRequestMessage | InviteMessage>,
  env: QueueEnv,
  client?: AuthModerationClient,
  inviteClient?: AuthInviteClient
): Promise<void> {
  // auth-moderation-requests-dlq, -dlq-stage, -dlq-qa
  const dlq = isDeadLetterQueue(batch.queue);
  for (const msg of batch.messages) {
    const body = msg.body;
    // Invites (lib/invites.ts) share this queue and client
    if (isInviteMessage(body)) {
      try {
        if (dlq) {
          await deadLetterInvite(env as unknown as InviteQueueEnv, body);
          msg.ack();
          continue;
        }
        const outcome = await processInvite(env as unknown as InviteQueueEnv, body, msg.attempts, inviteClient);
        if (outcome === 'retry') msg.retry({ delaySeconds: retryDelaySeconds(msg.attempts) });
        else msg.ack();
      } catch (error) {
        logger.error('[Invites] queue handler error', { id: body.id, op: body.op, error: errorText(error) });
        msg.retry({ delaySeconds: retryDelaySeconds(msg.attempts) });
      }
      continue;
    }
    if (!body || !['send', 'sync', 'info'].includes(body.type) || !body.id) {
      msg.ack();
      continue;
    }
    try {
      if (dlq) {
        await deadLetter(env, body);
        msg.ack();
        continue;
      }
      const outcome =
        body.type === 'send'
          ? await processSend(env, body.id, msg.attempts, client)
          : body.type === 'info'
            ? await processInfo(env, body.id, msg.attempts, client)
            : await processSync(env, body.id, msg.attempts, client);
      if (outcome === 'retry') msg.retry({ delaySeconds: retryDelaySeconds(msg.attempts) });
      else msg.ack();
    } catch (error) {
      logger.error('[AuthRequests] queue handler error', { id: body.id, type: body.type, error: errorText(error) });
      msg.retry({ delaySeconds: retryDelaySeconds(msg.attempts) });
    }
  }
}
