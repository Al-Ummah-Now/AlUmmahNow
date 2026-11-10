/**
 * /api/processing/* — upload processing health (2026-11-10 incident).
 *
 * Behind authMiddleware + adminMiddleware (src/index.ts); every route also
 * needs the `videos:processing` permission (admins and super admins). The
 * data and the work live in api-videos (VIDEOS service binding): "Sync from
 * Bunny" previews synchronously (read only) and applies by queueing each
 * video's processing-check loop; "Retry processing" queues the same loop;
 * "Mark failed" flags the video for re-upload and tells the uploader;
 * "Check thumbnails" queues the thumbnail aspect repair job (dry run first);
 * "Rebuild index" (Errors page, "Index out of sync") queues the ownership
 * index rebuild job or a search table's reconcile job; "Retry" on an index
 * repair puts failed per-object repairs back in the repair job's queue.
 *
 * Every change writes its audit row (site_settings_log, key
 * `processing:video:<id>`) before calling api-videos and removes it again if
 * the call fails, so no action goes unaudited.
 */
import { Hono, type Context } from 'hono';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { callProcessing, ProcessingApiError, type ProcessingClientEnv } from '../lib/processing/videosProcessing';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & ProcessingClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const PROCESSING_AUDIT_PREFIX = 'processing:video:';
const MAX_IDS = 100;

const app = new Hono<Env>();

const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';

app.use('*', async (c, next) => {
  if (!hasPermission(normalizeRoles(c.get('auth')?.roles), 'videos:processing')) {
    logger.warn('[Processing] Permission denied', { userId: actorOf(c), path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'The videos:processing permission is required' }, 403);
  }
  return next();
});

app.onError((error, c) => {
  if (error instanceof ProcessingApiError) {
    return c.json({ success: false, code: 'videos_error', error: error.message }, error.status as 400);
  }
  logger.error('[Processing] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

function parseIds(body: Record<string, unknown>): string[] | null {
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
  if (!ids.every((id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id))) return null;
  return [...new Set(ids as string[])];
}

/** One audit row per video, written before the change; returns their ids. */
async function writeAudit(c: C, ids: string[], action: string, details: Record<string, unknown>): Promise<string[]> {
  const db = c.env.REPORTS_DB;
  const now = new Date().toISOString();
  const rows = ids.map((id) => ({ rowId: crypto.randomUUID(), id }));
  await db.batch(
    rows.map(({ rowId, id }) =>
      db
        .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(rowId, `${PROCESSING_AUDIT_PREFIX}${id}`, null, JSON.stringify({ action, details }), actorOf(c), now),
    ),
  );
  return rows.map((r) => r.rowId);
}

async function dropAudit(c: C, rowIds: string[]): Promise<void> {
  const db = c.env.REPORTS_DB;
  await db.batch(rowIds.map((id) => db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(id))).catch((error) =>
    logger.error('[Processing] Could not drop the audit rows of a failed action', { error: String(error) }),
  );
}

async function audited<T>(c: C, ids: string[], action: string, details: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  const rowIds = await writeAudit(c, ids, action, details);
  try {
    const result = await run();
    logger.info('[Processing] Action', { action, count: ids.length, actorId: actorOf(c) });
    return result;
  } catch (error) {
    await dropAudit(c, rowIds);
    throw error;
  }
}

const body = async (c: C) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
const badIds = (c: C) => c.json({ success: false, code: 'bad_request', error: `ids must be 1-${MAX_IDS} video ids` }, 400);

/** Stuck videos with Bunny's state next to ours, and the reconciler's last run. */
app.get('/videos', async (c) => {
  const result = await callProcessing(c.env, '/videos', {
    query: { status: c.req.query('status'), channelId: c.req.query('channelId'), limit: c.req.query('limit'), cursor: c.req.query('cursor'), bunny: c.req.query('bunny') ?? '1' },
  });
  return c.json({ success: true, result });
});

/** Failures that need an admin: failed / flagged videos and dead-lettered checks. */
app.get('/errors', async (c) => {
  const result = await callProcessing(c.env, '/errors', { query: { limit: c.req.query('limit'), cursor: c.req.query('cursor') } });
  return c.json({ success: true, result });
});

/** Recent processing actions (audit), newest first. */
app.get('/audit', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  const id = c.req.query('videoId');
  const db = c.env.REPORTS_DB;
  const statement = id
    ? db.prepare('SELECT id, key, new_value, actor_id, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at DESC LIMIT ?').bind(`${PROCESSING_AUDIT_PREFIX}${id}`, limit)
    : db.prepare("SELECT id, key, new_value, actor_id, created_at FROM site_settings_log WHERE key >= ? AND key < ? ORDER BY created_at DESC LIMIT ?").bind(PROCESSING_AUDIT_PREFIX, 'processing:video;', limit);
  const { results = [] } = await statement.all<{ id: string; key: string; new_value: string; actor_id: string; created_at: string }>();
  const entries = results.map((row) => {
    let value: { action?: string; details?: unknown } = {};
    try {
      value = JSON.parse(row.new_value);
    } catch {
      value = {};
    }
    return { id: row.id, videoId: row.key.slice(PROCESSING_AUDIT_PREFIX.length), action: value.action ?? 'unknown', details: value.details ?? null, actorId: row.actor_id, createdAt: row.created_at };
  });
  return c.json({ success: true, result: { entries } });
});

/** Sync from Bunny: dryRun (default) previews; apply queues each video's check loop. */
app.post('/sync', async (c) => {
  const input = await body(c);
  const ids = parseIds(input);
  if (!ids) return badIds(c);
  const dryRun = input.dryRun !== false;
  if (dryRun) {
    const result = await callProcessing(c.env, '/sync', { method: 'POST', json: { ids, dryRun: true } });
    return c.json({ success: true, result });
  }
  const result = await audited(c, ids, 'sync_from_bunny', {}, () => callProcessing(c.env, '/sync', { method: 'POST', json: { ids, dryRun: false } }));
  return c.json({ success: true, result });
});

/** Retry processing: clears a failed/stalled flag and queues the check loop. */
app.post('/retry', async (c) => {
  const ids = parseIds(await body(c));
  if (!ids) return badIds(c);
  const result = await audited(c, ids, 'retry_processing', {}, () => callProcessing(c.env, '/retry', { method: 'POST', json: { ids } }));
  return c.json({ success: true, result });
});

/** Mark failed / needs re-upload (the uploader is notified). */
app.post('/mark-failed', async (c) => {
  const input = await body(c);
  const ids = parseIds(input);
  if (!ids) return badIds(c);
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  const result = await audited(c, ids, 'mark_failed', reason ? { reason } : {}, () =>
    callProcessing(c.env, '/mark-failed', { method: 'POST', json: { ids, ...(reason ? { reason } : {}) } }),
  );
  return c.json({ success: true, result });
});

/** Thumbnail aspect repair runs (admin jobs in api-videos), newest first. */
app.get('/thumbnails', async (c) => {
  const result = await callProcessing(c.env, '/thumbnails');
  return c.json({ success: true, result });
});

/**
 * Check thumbnails: queues the repair job over every video (or `ids`). A dry
 * run (default) only reports; applying replaces auto frames captured at the
 * wrong shape with Bunny's own thumbnail. Audited under the fixed key
 * processing:video:thumbnail-repair.
 */
app.post('/thumbnails', async (c) => {
  const input = await body(c);
  const ids = input.ids === undefined ? undefined : parseIds(input);
  if (ids === null) return badIds(c);
  const dryRun = input.dryRun !== false;
  const json = { dryRun, actorId: actorOf(c), ...(ids ? { ids } : {}) };
  if (dryRun) {
    const result = await callProcessing(c.env, '/thumbnails', { method: 'POST', json });
    return c.json({ success: true, result }, 202);
  }
  const result = await audited(c, ['thumbnail-repair'], 'repair_thumbnails', { scope: ids ? ids.length : 'all' }, () =>
    callProcessing(c.env, '/thumbnails', { method: 'POST', json }),
  );
  return c.json({ success: true, result }, 202);
});

/** Retry a failed thumbnail run: it resumes where it stopped. */
app.post('/thumbnails/:jobId/retry', async (c) => {
  const jobId = c.req.param('jobId');
  if (!/^[0-9a-f-]{36}$/.test(jobId)) return c.json({ success: false, code: 'bad_request', error: 'Unknown run' }, 400);
  const result = await audited(c, ['thumbnail-repair'], 'retry_thumbnail_repair', { jobId }, () =>
    callProcessing(c.env, `/thumbnails/${jobId}/retry`, { method: 'POST' }),
  );
  return c.json({ success: true, result });
});

const INDEX_KINDS = ['video', 'channel', 'profile', 'playlist', 'stream', 'search:video', 'search:channel', 'search:playlist', 'search:post'];
const REPAIR_ENTITIES = ['video', 'channel', 'playlist', 'post', 'profile', 'stream'];

/**
 * Rebuild one index: the ownership index of a kind (the admin's video,
 * channel and user lists read it) or a search table (`search:<entity>`).
 * Queues the admin job, or returns the one already running. Audited under
 * the fixed key processing:video:ownership-index.
 */
app.post('/index-rebuild', async (c) => {
  const input = await body(c);
  if (typeof input.kind !== 'string' || !INDEX_KINDS.includes(input.kind)) {
    return c.json({ success: false, code: 'bad_request', error: 'kind must be video, channel, profile, playlist, stream or search:<video|channel|playlist|post>' }, 400);
  }
  const json = { kind: input.kind, actorId: actorOf(c) };
  const result = await audited(c, ['ownership-index'], 'rebuild_ownership_index', { kind: input.kind }, () =>
    callProcessing(c.env, '/index-rebuild', { method: 'POST', json }),
  );
  return c.json({ success: true, result }, 202);
});

/**
 * Retry failed per-object index repairs (Errors page): one ({ entity, id }) or
 * all of them ({}). Audited under processing:video:index-repairs.
 */
app.post('/index-repairs/retry', async (c) => {
  const input = await body(c);
  const one = input.entity !== undefined || input.id !== undefined;
  if (one && (typeof input.entity !== 'string' || !REPAIR_ENTITIES.includes(input.entity) || typeof input.id !== 'string' || !/^[A-Za-z0-9_.:/-]{1,200}$/.test(input.id))) {
    return c.json({ success: false, code: 'bad_request', error: 'entity and id name one repair (omit both to retry every failed one)' }, 400);
  }
  const json = one ? { entity: input.entity, id: input.id } : {};
  const result = await audited(c, ['index-repairs'], 'retry_index_repairs', json, () =>
    callProcessing(c.env, '/index-repairs/retry', { method: 'POST', json }),
  );
  return c.json({ success: true, result });
});

export default app;
