/**
 * /api/uploads/stale/* — Stale uploads: abandoned upload placeholders and
 * Bunny videos without a record (owner, 2026-11-10: every retried upload left
 * a Bunny video behind).
 *
 * Behind authMiddleware + adminMiddleware (src/index.ts); every route also
 * needs the `videos:uploads` permission (admins and super admins). This is
 * the videos admin's own permission, never the Auth admin's RBAC. The data and
 * the work live in api-videos (VIDEOS service binding, /internal/uploads):
 * Delete now and Retry queue the item's reaper check (async, retried,
 * dead-lettered, flagged on failure); Keep stops the reaper picking it again;
 * the mode switch takes the automatic reaper out of dry-run.
 *
 * Every change writes its audit row (site_settings_log, key
 * `uploads:stale:<id>`, or `uploads:reaper:mode`) before calling api-videos
 * and removes it again if the call fails, so no action goes unaudited.
 */
import { Hono, type Context } from 'hono';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { callUploads, UploadsApiError, type UploadsClientEnv } from '../lib/uploads/videosUploads';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & UploadsClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const STALE_UPLOAD_AUDIT_PREFIX = 'uploads:stale:';
export const REAPER_MODE_AUDIT_KEY = 'uploads:reaper:mode';
export const TEST_LIBRARY_PURGE_AUDIT_KEY = 'uploads:test-library-purge';
const MAX_IDS = 100;

const app = new Hono<Env>();

const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
/** What api-videos records as the actor on its own audit rows (who pressed the button). */
const actorLabel = (c: C) => c.get('auth')?.email || actorOf(c);

app.use('*', async (c, next) => {
  if (!hasPermission(normalizeRoles(c.get('auth')?.roles), 'videos:uploads')) {
    logger.warn('[StaleUploads] Permission denied', { userId: actorOf(c), path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'The videos:uploads permission is required' }, 403);
  }
  return next();
});

app.onError((error, c) => {
  if (error instanceof UploadsApiError) {
    return c.json({ success: false, code: 'videos_error', error: error.message }, error.status as 400);
  }
  logger.error('[StaleUploads] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

function parseIds(body: Record<string, unknown>): string[] | null {
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
  if (!ids.every((id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id))) return null;
  return [...new Set(ids as string[])];
}

/** Audit rows written before the change; returns their ids. */
async function writeAudit(c: C, keys: string[], action: string, details: Record<string, unknown>): Promise<string[]> {
  const db = c.env.REPORTS_DB;
  const now = new Date().toISOString();
  const rows = keys.map((key) => ({ rowId: crypto.randomUUID(), key }));
  await db.batch(
    rows.map(({ rowId, key }) =>
      db
        .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(rowId, key, null, JSON.stringify({ action, details }), actorOf(c), now),
    ),
  );
  return rows.map((r) => r.rowId);
}

async function dropAudit(c: C, rowIds: string[]): Promise<void> {
  const db = c.env.REPORTS_DB;
  await db.batch(rowIds.map((id) => db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(id))).catch((error) =>
    logger.error('[StaleUploads] Could not drop the audit rows of a failed action', { error: String(error) }),
  );
}

async function audited<T>(c: C, keys: string[], action: string, details: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  const rowIds = await writeAudit(c, keys, action, details);
  try {
    const result = await run();
    logger.info('[StaleUploads] Action', { action, count: keys.length, actorId: actorOf(c) });
    return result;
  } catch (error) {
    await dropAudit(c, rowIds);
    throw error;
  }
}

const body = async (c: C) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
const badIds = (c: C) => c.json({ success: false, code: 'bad_request', error: `ids must be 1-${MAX_IDS} video ids` }, 400);
const itemKeys = (ids: string[]) => ids.map((id) => `${STALE_UPLOAD_AUDIT_PREFIX}${id}`);

/** Abandoned placeholders and orphans with Bunny status and age; reaper mode, last sweep, recent deletes, dead letters. */
app.get('/', async (c) => {
  const result = await callUploads(c.env, '/stale', { query: { status: c.req.query('status'), limit: c.req.query('limit') } });
  return c.json({ success: true, result });
});

/** Recent admin actions on stale uploads (audit), newest first. */
app.get('/audit', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  const db = c.env.REPORTS_DB;
  const { results = [] } = await db
    .prepare("SELECT id, key, new_value, actor_id, created_at FROM site_settings_log WHERE key >= ? AND key < ? ORDER BY created_at DESC LIMIT ?")
    .bind('uploads:', 'uploads;', limit)
    .all<{ id: string; key: string; new_value: string; actor_id: string; created_at: string }>();
  const entries = results.map((row) => {
    let value: { action?: string; details?: unknown } = {};
    try {
      value = JSON.parse(row.new_value);
    } catch {
      value = {};
    }
    const videoId = row.key.startsWith(STALE_UPLOAD_AUDIT_PREFIX) ? row.key.slice(STALE_UPLOAD_AUDIT_PREFIX.length) : null;
    return { id: row.id, videoId, action: value.action ?? 'unknown', details: value.details ?? null, actorId: row.actor_id, createdAt: row.created_at };
  });
  return c.json({ success: true, result: { entries } });
});

/** Scan now: run the reaper's sweep (it only queues checks). */
app.post('/scan', async (c) => {
  const result = await callUploads(c.env, '/scan', { method: 'POST', json: { actor: actorLabel(c) } });
  return c.json({ success: true, result });
});

/** Delete now: queue a forced check (still never deletes a ready video). */
app.post('/delete', async (c) => {
  const ids = parseIds(await body(c));
  if (!ids) return badIds(c);
  const result = await audited(c, itemKeys(ids), 'delete_now', {}, () => callUploads(c.env, '/delete', { method: 'POST', json: { ids, actor: actorLabel(c) } }));
  return c.json({ success: true, result });
});

/** Keep: the reaper never picks these again (until Retry). */
app.post('/keep', async (c) => {
  const ids = parseIds(await body(c));
  if (!ids) return badIds(c);
  const result = await audited(c, itemKeys(ids), 'keep', {}, () => callUploads(c.env, '/keep', { method: 'POST', json: { ids, actor: actorLabel(c) } }));
  return c.json({ success: true, result });
});

/** Retry: restart the item's check (a failed or kept item). */
app.post('/retry', async (c) => {
  const ids = parseIds(await body(c));
  if (!ids) return badIds(c);
  const result = await audited(c, itemKeys(ids), 'retry', {}, () => callUploads(c.env, '/retry', { method: 'POST', json: { ids, actor: actorLabel(c) } }));
  return c.json({ success: true, result });
});

/** Automatic deletion: dry-run (records "would delete") or live. */
app.post('/mode', async (c) => {
  const mode = (await body(c)).mode;
  if (mode !== 'dry-run' && mode !== 'live') return c.json({ success: false, code: 'bad_request', error: 'mode must be dry-run or live' }, 400);
  const result = await audited(c, [REAPER_MODE_AUDIT_KEY], 'set_mode', { mode }, () => callUploads(c.env, '/mode', { method: 'POST', json: { mode, actor: actorLabel(c) } }));
  return c.json({ success: true, result });
});

/**
 * QA / stage only: the test-library purge (api-videos
 * lib/uploads/testLibraryPurge.ts) removes every Bunny video of this
 * environment that has no record. api-videos refuses it on production.
 */
app.get('/test-library-purge', async (c) => {
  const result = await callUploads(c.env, '/test-library-purge');
  return c.json({ success: true, result });
});

/** Start (dry run unless dryRun is false; resume continues a stopped / failed run) or stop the purge. */
app.post('/test-library-purge', async (c) => {
  const input = await body(c);
  const action = input.action;
  if (action !== 'start' && action !== 'stop') return c.json({ success: false, code: 'bad_request', error: 'action must be start or stop' }, 400);
  const dryRun = input.dryRun !== false;
  const resume = input.resume === true;
  // Optional tuning (api-videos clamps: min age 10 min-24 h, 1-50 in flight, 10-100 per page)
  const tuning = Object.fromEntries((['minAgeMinutes', 'concurrency', 'pageSize'] as const).filter((k) => typeof input[k] === 'number').map((k) => [k, input[k]]));
  const result = await audited(c, [TEST_LIBRARY_PURGE_AUDIT_KEY], `test_library_purge_${action}`, action === 'start' ? { dryRun, resume, ...tuning } : {}, () =>
    callUploads(c.env, '/test-library-purge', { method: 'POST', json: { action, dryRun, resume, ...tuning, actor: actorLabel(c) } }),
  );
  return c.json({ success: true, result });
});

export default app;
