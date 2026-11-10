/**
 * /api/auth-requests: moderation requests to auth (docs/admin/AUTH_MODERATION_REQUESTS.md).
 *
 *   GET  /api/auth-requests                   requests sent (subject_user_id, status, delivery), newest first
 *   GET  /api/auth-requests/evidence          the evidence a new request would attach for a user
 *   POST /api/auth-requests                   queue a request to auth (admins) → 202, delivery 'sending'
 *   GET  /api/auth-requests/:id               one request
 *   POST /api/auth-requests/:id/retry         send a failed request again / re-read a failed status (admins)
 *   POST /api/auth-requests/:id/info          queue an answer to auth's request for more information (admins)
 *
 * Nothing here talks to auth: sending, answers and status reads go through the
 * auth-moderation-requests queue with retries (lib/authModerationQueue.ts). Reads
 * queue a status refresh for open requests (at most every 30 s per request).
 * Moderators and admins can read; only admins and super admins send. Every send,
 * retry and answer is in the videos admin audit log (admin_audit_log).
 */
import { AdminRoute, AppContext } from '../../base';
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import { canRequestAuthAction } from '../../lib/roles';
import {
  AUTH_REQUEST_STATUSES,
  ProvideInfoSchema,
  SubmitSchema,
  audit,
  buildEvidence,
  composeReason,
  getRow,
  insertSending,
  markDelivery,
  newLocalId,
  reportsOnUserContent,
  toView,
  type MirrorRow,
} from '../../lib/authModeration';
import { enqueueSend, enqueueSyncs } from '../../lib/authModerationQueue';

const ok = (description: string) => ({ "200": { description, content: { "application/json": { schema: z.object({ success: z.boolean() }).passthrough() } } } });

function requester(c: AppContext) {
  const auth = c.get('auth')!;
  const name = typeof auth.payload?.name === 'string' && auth.payload.name ? auth.payload.name : auth.email || auth.userId;
  return { id: auth.userId, display_name: String(name).slice(0, 200), email: auth.email ?? null };
}

/** Queue status reads without failing the read if the queue is unavailable. */
async function refreshLater(c: AppContext, rows: MirrorRow[]) {
  try {
    await enqueueSyncs(c.env, rows);
  } catch (error) {
    logger.warn('[AuthRequests] could not queue status reads', { error: String(error) });
  }
}

const ListQuery = z.object({
  subject_user_id: z.string().optional(),
  status: z.enum(AUTH_REQUEST_STATUSES).optional(),
  delivery: z.enum(['sending', 'sent', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export class AuthRequestsList extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['Auth requests'],
    summary: 'List moderation requests sent to auth',
    request: { query: ListQuery },
    responses: ok('Requests, newest first; open ones get a status refresh queued'),
  });

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const where: string[] = [];
    const values: unknown[] = [];
    if (query.subject_user_id) {
      where.push('subject_user_id = ?');
      values.push(query.subject_user_id);
    }
    if (query.status) {
      where.push('status = ?');
      values.push(query.status);
    }
    if (query.delivery) {
      where.push('delivery_status = ?');
      values.push(query.delivery);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const [{ results }, count, failed] = await Promise.all([
      c.env.REPORTS_DB.prepare(`SELECT * FROM auth_moderation_requests ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<MirrorRow>(),
      c.env.REPORTS_DB.prepare(`SELECT COUNT(*) AS n FROM auth_moderation_requests ${clause}`).bind(...values).first<{ n: number }>(),
      c.env.REPORTS_DB.prepare(
        "SELECT COUNT(*) AS n FROM auth_moderation_requests WHERE delivery_status = 'failed' OR (sync_error IS NOT NULL AND (status IS NULL OR status NOT IN ('rejected', 'actioned')))"
      ).first<{ n: number }>(),
    ]);
    const rows = results ?? [];
    await refreshLater(c, rows);
    return {
      success: true,
      result: rows.map(toView),
      total: count?.n ?? 0,
      /** Requests that need a videos admin: not delivered, or their status/answer failed after retries */
      needsAttention: failed?.n ?? 0,
      limit,
      offset,
      canRequest: canRequestAuthAction(this.getRoles(c)),
    };
  }
}

export class AuthRequestEvidence extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['Auth requests'],
    summary: 'Evidence a new request would attach for a user',
    request: { query: z.object({ subject_user_id: z.string().min(1) }) },
    responses: ok('Evidence links and the reports they come from'),
  });

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const reports = await reportsOnUserContent(c.env.REPORTS_DB, c.env.SEARCH_DB, query.subject_user_id).catch((error) => {
      logger.warn('[AuthRequests] could not read reports for evidence', { error: String(error) });
      return [];
    });
    return {
      success: true,
      result: {
        reports,
        evidence: buildEvidence({ adminWebUrl: c.env.ADMIN_WEB_URL, subjectUserId: query.subject_user_id, reportIds: reports.map((r) => r.id) }),
      },
    };
  }
}

export class AuthRequestCreate extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['Auth requests'],
    summary: 'Ask auth to act on a user\'s auth account',
    description: 'Admins and super admins. Queued (202, delivery "sending"); the queue sends it to auth with retries. Attaches the user\'s videos admin page and reports on their content as evidence.',
    request: { body: { content: { 'application/json': { schema: SubmitSchema } } } },
    responses: ok('The request, queued'),
  });

  async handle(c: AppContext) {
    if (!canRequestAuthAction(this.getRoles(c))) {
      return c.json({ success: false, error: 'Only admins can send requests to auth' }, 403);
    }
    const { body } = await this.getValidatedData<typeof this.schema>();
    const by = requester(c);
    const key = body.idempotency_key || crypto.randomUUID();

    const existing = await c.env.REPORTS_DB.prepare('SELECT * FROM auth_moderation_requests WHERE idempotency_key = ?').bind(key).first<MirrorRow>();
    if (existing) return { success: true, result: toView(existing), replayed: true };

    const reports = await reportsOnUserContent(c.env.REPORTS_DB, c.env.SEARCH_DB, body.subject_user_id).catch(() => []);
    const reportIds = [...new Set([...(body.report_ids ?? []), ...reports.map((r) => r.id)])];
    const evidence = buildEvidence({ adminWebUrl: c.env.ADMIN_WEB_URL, subjectUserId: body.subject_user_id, reportIds, extra: body.evidence });
    const id = newLocalId();
    const inserted = await insertSending(c.env.REPORTS_DB, {
      id,
      subject_user_id: body.subject_user_id,
      action: body.action,
      reason_category: body.reason_category,
      reason: composeReason(body.reason, body.note),
      evidence,
      requested_by_id: by.id,
      requested_by_name: by.display_name,
      idempotency_key: key,
    });
    if (!inserted) {
      // Same key raced in: answer with that request
      const raced = await c.env.REPORTS_DB.prepare('SELECT * FROM auth_moderation_requests WHERE idempotency_key = ?').bind(key).first<MirrorRow>();
      return { success: true, result: toView(raced!), replayed: true };
    }
    await audit(c.env.REPORTS_DB, {
      actorId: by.id,
      actorEmail: by.email,
      action: 'auth_request.created',
      targetType: 'user',
      targetId: body.subject_user_id,
      metadata: { requestId: id, action: body.action, reasonCategory: body.reason_category, evidence: evidence.length },
    });
    await enqueueSend(c.env, { id, subject_user_id: body.subject_user_id }, by.id);
    return c.json({ success: true, result: toView((await getRow(c.env.REPORTS_DB, id))!) }, 202);
  }
}

const IdParams = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });

export class AuthRequestGet extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['Auth requests'],
    summary: 'One request; queues a status refresh if it is open',
    request: { params: IdParams },
    responses: ok('The request'),
  });

  async handle(c: AppContext) {
    const { params } = await this.getValidatedData<typeof this.schema>();
    const row = await getRow(c.env.REPORTS_DB, params.id);
    if (!row) return c.json({ success: false, error: 'Request not found' }, 404);
    await refreshLater(c, [row]);
    return { success: true, result: toView(row) };
  }
}

export class AuthRequestRetry extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['Auth requests'],
    summary: 'Retry a request that was not delivered, or whose status read or answer failed',
    request: { params: IdParams },
    responses: ok('The request, queued again'),
  });

  async handle(c: AppContext) {
    if (!canRequestAuthAction(this.getRoles(c))) {
      return c.json({ success: false, error: 'Only admins can retry requests to auth' }, 403);
    }
    const { params } = await this.getValidatedData<typeof this.schema>();
    const row = await getRow(c.env.REPORTS_DB, params.id);
    if (!row) return c.json({ success: false, error: 'Request not found' }, 404);
    const by = requester(c);
    if (row.delivery_status === 'failed') {
      await markDelivery(c.env.REPORTS_DB, row.id, 'sending', 0, null);
      await audit(c.env.REPORTS_DB, { actorId: by.id, actorEmail: by.email, action: 'auth_request.retried', targetType: 'user', targetId: row.subject_user_id, metadata: { requestId: row.id, previousError: row.delivery_error } });
      await enqueueSend(c.env, row, by.id);
    } else if (row.delivery_status === 'sent' && (row.sync_error || row.pending_info)) {
      await c.env.REPORTS_DB.prepare('UPDATE auth_moderation_requests SET sync_error = NULL, sync_requested_at = NULL WHERE id = ?').bind(row.id).run();
      await audit(c.env.REPORTS_DB, { actorId: by.id, actorEmail: by.email, action: 'auth_request.retried', targetType: 'user', targetId: row.subject_user_id, metadata: { requestId: row.id, previousError: row.sync_error } });
      if (row.pending_info) await c.env.AUTH_REQUESTS_QUEUE?.send({ type: 'info', id: row.id }, { contentType: 'json' });
      else await enqueueSyncs(c.env, [{ ...row, sync_requested_at: null }]);
    } else {
      return c.json({ success: false, error: `Nothing to retry: the request is ${row.delivery_status}` }, 409);
    }
    return c.json({ success: true, result: toView((await getRow(c.env.REPORTS_DB, row.id))!) }, 202);
  }
}

export class AuthRequestProvideInfo extends AdminRoute {
  schema = addAuthToSchema({
    tags: ['Auth requests'],
    summary: 'Answer auth\'s request for more information (queued)',
    request: { params: IdParams, body: { content: { 'application/json': { schema: ProvideInfoSchema } } } },
    responses: ok('The request, with the answer queued'),
  });

  async handle(c: AppContext) {
    if (!canRequestAuthAction(this.getRoles(c))) {
      return c.json({ success: false, error: 'Only admins can answer auth' }, 403);
    }
    const { params, body } = await this.getValidatedData<typeof this.schema>();
    const row = await getRow(c.env.REPORTS_DB, params.id);
    if (!row) return c.json({ success: false, error: 'Request not found' }, 404);
    if (row.delivery_status !== 'sent' || row.status !== 'info_requested') {
      return c.json({ success: false, error: 'Auth is not waiting for more information on this request' }, 409);
    }
    const by = requester(c);
    const answer = { note: body.note, evidence: body.evidence ?? [], requested_by: { id: by.id, display_name: by.display_name } };
    await c.env.REPORTS_DB.prepare('UPDATE auth_moderation_requests SET pending_info = ?, sync_error = NULL, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(answer), new Date().toISOString(), row.id)
      .run();
    await audit(c.env.REPORTS_DB, { actorId: by.id, actorEmail: by.email, action: 'auth_request.info_provided', targetType: 'user', targetId: row.subject_user_id, metadata: { requestId: row.id } });
    try {
      if (!c.env.AUTH_REQUESTS_QUEUE) throw new Error('The auth-moderation-requests queue is not configured');
      await c.env.AUTH_REQUESTS_QUEUE.send({ type: 'info', id: row.id }, { contentType: 'json' });
    } catch (error) {
      await c.env.REPORTS_DB.prepare('UPDATE auth_moderation_requests SET sync_error = ? WHERE id = ?').bind(`Answer not queued: ${String(error)}`, row.id).run();
    }
    return c.json({ success: true, result: toView((await getRow(c.env.REPORTS_DB, row.id))!) }, 202);
  }
}
