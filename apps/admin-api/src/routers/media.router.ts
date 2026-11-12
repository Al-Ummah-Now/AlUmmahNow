/**
 * /api/media/* — Delivery comparison (epic #687): video delivery on R2 +
 * Cloudflare CDN side by side with Bunny (docs/media-delivery/R2-DELIVERY-PLAN.md).
 *
 * Behind authMiddleware + adminMiddleware (src/index.ts); every route also
 * needs the `media:manage` permission (admins and super admins). The data and
 * the work live in api-videos' /internal/media/* (VIDEOS service binding).
 *
 *   GET  /summary?days=     time to playable, QoE per source per day, cost inputs, the switch, and
 *                           live (transcoding now, waiting, max concurrent, oldest wait)
 *   GET  /summary?only=live just the live figures (the Delivery page polls them every 30 s)
 *   GET  /jobs?status=&limit=  recent R2 transcode jobs
 *   POST /retry { ids }     transcode again (audited per video, key media:video:<id>)
 *   GET  /settings          the delivery switch
 *   PUT  /settings          change it (audited, key media:delivery, old and new value)
 *
 * Every change writes its audit row (site_settings_log) before calling
 * api-videos and removes it again if the call fails, so no change goes unaudited.
 */
import { Hono, type Context } from 'hono';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { callVideosInternal, ProcessingApiError, type ProcessingClientEnv } from '../lib/processing/videosProcessing';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & ProcessingClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const MEDIA_VIDEO_AUDIT_PREFIX = 'media:video:';
export const MEDIA_SETTINGS_AUDIT_KEY = 'media:delivery';
const MAX_IDS = 50;
const JOB_STATUSES = ['queued', 'transcoding', 'ready', 'failed'];
const MODES = ['bunny', 'r2', 'split'];
const ASSIGNS = ['video', 'view'];

const app = new Hono<Env>();

const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';

app.use('*', async (c, next) => {
  if (!hasPermission(normalizeRoles(c.get('auth')?.roles), 'media:manage')) {
    logger.warn('[Media] Permission denied', { userId: actorOf(c), path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'The media:manage permission is required' }, 403);
  }
  return next();
});

app.onError((error, c) => {
  if (error instanceof ProcessingApiError) {
    return c.json({ success: false, code: 'videos_error', error: error.message }, error.status as 400);
  }
  logger.error('[Media] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

const bad = (c: C, error: string) => c.json({ success: false, code: 'bad_request', error }, 400);

/** Inserts the audit rows before a change; returns a function that removes them (the change failed). */
async function writeAudit(c: C, rows: { key: string; oldValue: unknown; newValue: unknown }[]): Promise<() => Promise<void>> {
  const db = c.env.REPORTS_DB;
  const now = new Date().toISOString();
  const ids = rows.map(() => crypto.randomUUID());
  await db.batch(
    rows.map((row, i) =>
      db
        .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(ids[i], row.key, row.oldValue === undefined ? null : JSON.stringify(row.oldValue), JSON.stringify(row.newValue), actorOf(c), now),
    ),
  );
  return async () => {
    await db.batch(ids.map((id) => db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(id))).catch((error) =>
      logger.error('[Media] Could not drop the audit rows of a failed change', { error: String(error) }),
    );
  };
}

async function audited<T>(c: C, rows: { key: string; oldValue: unknown; newValue: unknown }[], run: () => Promise<T>): Promise<T> {
  const drop = await writeAudit(c, rows);
  try {
    return await run();
  } catch (error) {
    await drop();
    throw error;
  }
}

app.get('/summary', async (c) => {
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '30', 10) || 30, 1), 120);
  const only = c.req.query('only') === 'live' ? 'live' : undefined;
  const result = await callVideosInternal(c.env, '/internal/media/summary', { query: { days: String(days), only } });
  return c.json({ success: true, result });
});

app.get('/jobs', async (c) => {
  const status = c.req.query('status');
  if (status && !JOB_STATUSES.includes(status)) return bad(c, `status must be one of ${JOB_STATUSES.join(', ')}`);
  const result = await callVideosInternal(c.env, '/internal/media/jobs', { query: { status, limit: c.req.query('limit') } });
  return c.json({ success: true, result });
});

/** Transcode again (failed jobs, or any video an admin wants re-encoded). */
app.post('/retry', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id))) {
    return bad(c, `ids must be 1-${MAX_IDS} video ids`);
  }
  const unique = [...new Set(ids as string[])];
  const result = await audited(
    c,
    unique.map((id) => ({ key: `${MEDIA_VIDEO_AUDIT_PREFIX}${id}`, oldValue: undefined, newValue: { action: 'transcode_again' } })),
    () => callVideosInternal(c.env, '/internal/media/retry', { method: 'POST', json: { ids: unique } }),
  );
  logger.info('[Media] Transcode again', { count: unique.length, actorId: actorOf(c) });
  return c.json({ success: true, result });
});

app.get('/settings', async (c) => {
  const result = await callVideosInternal(c.env, '/internal/media/settings');
  return c.json({ success: true, result });
});

/** Validates a settings change; every field is optional, unknown values are refused. */
export function parseSettingsInput(body: Record<string, unknown>): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value: Record<string, unknown> = {};
  if (body.mode !== undefined) {
    if (typeof body.mode !== 'string' || !MODES.includes(body.mode)) return { ok: false, error: 'mode must be bunny, r2 or split' };
    value.mode = body.mode;
  }
  if (body.r2Percent !== undefined) {
    if (typeof body.r2Percent !== 'number' || !Number.isInteger(body.r2Percent) || body.r2Percent < 0 || body.r2Percent > 100) {
      return { ok: false, error: 'r2Percent must be a whole number 0-100' };
    }
    value.r2Percent = body.r2Percent;
  }
  if (body.assign !== undefined) {
    if (typeof body.assign !== 'string' || !ASSIGNS.includes(body.assign)) return { ok: false, error: 'assign must be video or view' };
    value.assign = body.assign;
  }
  if (body.transcode !== undefined) {
    if (typeof body.transcode !== 'boolean') return { ok: false, error: 'transcode must be true or false' };
    value.transcode = body.transcode;
  }
  if (!Object.keys(value).length) return { ok: false, error: 'Nothing to change' };
  return { ok: true, value };
}

app.put('/settings', async (c) => {
  const parsed = parseSettingsInput((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
  if ('error' in parsed) return bad(c, parsed.error);
  const current = await callVideosInternal<Record<string, unknown>>(c.env, '/internal/media/settings');
  const result = await audited(c, [{ key: MEDIA_SETTINGS_AUDIT_KEY, oldValue: current, newValue: { ...current, ...parsed.value } }], () =>
    callVideosInternal(c.env, '/internal/media/settings', { method: 'PUT', json: { ...parsed.value, actorId: actorOf(c) } }),
  );
  logger.info('[Media] Delivery settings changed', { actorId: actorOf(c), ...parsed.value });
  return c.json({ success: true, result });
});

export default app;
