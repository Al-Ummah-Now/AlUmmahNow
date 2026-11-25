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
 *   GET  /qoe-live?minutes= playback quality per provider per minute (last 60 by default) and plays now
 *   GET  /jobs?status=&limit=  recent R2 transcode jobs
 *   POST /retry { ids }     transcode again (audited per video, key media:video:<id>)
 *   GET  /settings          the legacy delivery switch view (old admin builds)
 *   PUT  /settings          change it (audited, key media:delivery, old and new value)
 *   GET  /providers         provider settings, health and problems (docs/media-delivery/PROVIDERS.md)
 *   PUT  /providers { settings }  replace them (audited, key media:delivery); 400 { problems } when unsafe
 *   POST /health/check      one provider health pass now
 *   /backfill/*             R2 backfill runs (estimate, settings, start/pause/cancel, items, Retry), "play R2
 *                           first" (video / channel / global) and Bunny library retirement; audited as
 *                           media:backfill:<run>, media:video:<id>, media:delivery and media:bunny-retire:<library>
 *   PUT  /videos/:id/override { override | null }  pin one video's playback providers (audited, key
 *                           media:video:<id>); 400 { problems } when it would leave the video unplayable
 *
 *   GET  /transcode-limit   concurrent R2 transcodes range (autoscaled min–max): the setting, what is
 *                           enforced, the ceiling and the cost of a slot (media:read: moderators too)
 *   PUT  /transcode-limit { min, max, undo? }  change it, 1 ≤ min ≤ max ≤ ceiling (audited, key media:transcode-limit);
 *                           the admin's field is Video providers → Cloudflare R2 settings
 *   GET  /summary?only=live is media:read too (the live figures)
 *   /troubleshoot/*         transcode troubleshooting: per-job view, containers, queues, logs, Retry now,
 *                           Cancel, the read-only Cloudflare token (mediaTroubleshoot.router.ts)
 *
 * Every change writes its audit row (site_settings_log) before calling
 * api-videos and removes it again if the call fails, so no change goes unaudited.
 */
import { Hono, type Context } from 'hono';
import { baseName, normaliseMediaSettings, settingsProblems, TRANSCODE_LIMIT_AUDIT_KEY, transcodeRangeProblem, VIDEO_FAILURES_MAX, type VideoFailure } from '@al-ummah/shared-types';
import { hasPermission, normalizeRoles } from '../lib/roles';
import { callVideosInternal, ProcessingApiError, type ProcessingClientEnv } from '../lib/processing/videosProcessing';
import { withoutHiddenVideos } from '../lib/moderation/takedown';
import { logger } from '../lib/logger';
import troubleshootRouter from './mediaTroubleshoot.router';
import type { AdminBindings, AuthContext } from '../base/types';
import { auditOriginJson } from '../lib/request-origin';

type Env = { Bindings: AdminBindings & ProcessingClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const MEDIA_VIDEO_AUDIT_PREFIX = 'media:video:';
export const MEDIA_SETTINGS_AUDIT_KEY = 'media:delivery';
const MAX_IDS = 50;
const JOB_STATUSES = ['queued', 'transcoding', 'ready', 'failed', 'cancelled'];
const MODES = ['bunny', 'r2', 'split'];
const ASSIGNS = ['video', 'view'];

const app = new Hono<Env>();

const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';

/**
 * What moderators may read (media:read): the max concurrent transcodes and the live figures. Everything
 * else, and every change, needs media:manage.
 */
export function mediaPermissionFor(method: string, path: string, query: (name: string) => string | undefined): 'media:read' | 'media:manage' {
  if (method !== 'GET') return 'media:manage';
  if (path.endsWith('/transcode-limit')) return 'media:read';
  if (path.endsWith('/summary') && query('only') === 'live') return 'media:read';
  return 'media:manage';
}

app.use('*', async (c, next) => {
  const needed = mediaPermissionFor(c.req.method, c.req.path, (n) => c.req.query(n));
  if (!hasPermission(normalizeRoles(c.get('auth')?.roles), needed)) {
    logger.warn('[Media] Permission denied', { userId: actorOf(c), path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: `The ${needed} permission is required` }, 403);
  }
  return next();
});

app.onError((error, c) => {
  if (error instanceof ProcessingApiError) {
    return c.json({ success: false, code: 'videos_error', error: error.message, ...(error.problems ? { problems: error.problems } : {}) }, error.status as 400);
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
        .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(ids[i], row.key, row.oldValue === undefined ? null : JSON.stringify(row.oldValue), JSON.stringify(row.newValue), actorOf(c), now, auditOriginJson()),
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

app.route('/troubleshoot', troubleshootRouter as never);

app.get('/summary', async (c) => {
  const days = Math.min(Math.max(parseInt(c.req.query('days') || '30', 10) || 30, 1), 120);
  const only = c.req.query('only') === 'live' ? 'live' : undefined;
  const result = await callVideosInternal(c.env, '/internal/media/summary', { query: { days: String(days), only } });
  return c.json({ success: true, result });
});

app.get('/qoe-live', async (c) => {
  const minutes = Math.min(Math.max(parseInt(c.req.query('minutes') || '60', 10) || 60, 1), 2880);
  const result = await callVideosInternal(c.env, '/internal/media/qoe-live', { query: { minutes: String(minutes) } });
  return c.json({ success: true, result });
});

app.get('/jobs', async (c) => {
  const status = c.req.query('status');
  if (status && !JOB_STATUSES.includes(status)) return bad(c, `status must be one of ${JOB_STATUSES.join(', ')}`);
  const result = await callVideosInternal<{ items?: { video_id: string }[] }>(c.env, '/internal/media/jobs', { query: { status, limit: c.req.query('limit') } });
  const items = await withoutHiddenVideos(c.env.REPORTS_DB, c.get('auth')?.roles, result.items ?? [], (j) => j.video_id);
  return c.json({ success: true, result: { ...result, items } });
});

/**
 * Why videos failed (shared-types video-failure.ts): the one answer of every admin page that shows them. api-videos
 * knows why; the name of an imported file is the import's (import_items, one index seek per id).
 */
app.get('/failures', async (c) => {
  const ids = [...new Set((c.req.query('ids') ?? '').split(',').filter(Boolean))];
  if (!ids.length || ids.length > VIDEO_FAILURES_MAX || !ids.every((id) => /^[A-Za-z0-9-]{8,64}$/.test(id))) return bad(c, `ids must be 1-${VIDEO_FAILURES_MAX} video ids`);
  // Only of the videos the reader's lists show
  const shown = await withoutHiddenVideos(c.env.REPORTS_DB, c.get('auth')?.roles, ids, (id) => id);
  const { items } = shown.length ? await callVideosInternal<{ items: VideoFailure[] }>(c.env, '/internal/media/failures', { query: { ids: shown.join(',') } }) : { items: [] };
  const files = items.length ? await importedFiles(c, items.map((f) => f.videoId)) : new Map<string, { file_name: string; batch_id: string }>();
  return c.json({
    success: true,
    result: {
      items: items.map((f) => {
        const file = files.get(f.videoId);
        return file ? { ...f, fileName: baseName(file.file_name), importBatchId: file.batch_id } : f;
      }),
    },
  });
});

/** The newest import item of each video. Without it the failures still say why. */
async function importedFiles(c: C, ids: string[]): Promise<Map<string, { file_name: string; batch_id: string }>> {
  try {
    const { results } = await c.env.REPORTS_DB.prepare(
      'SELECT i.video_id, i.file_name, i.batch_id FROM json_each(?) j CROSS JOIN import_items i INDEXED BY idx_import_items_video ON i.video_id = j.value WHERE i.video_id IS NOT NULL ORDER BY i.created_at',
    )
      .bind(JSON.stringify(ids))
      .all<{ video_id: string; file_name: string; batch_id: string }>();
    return new Map((results ?? []).map((r) => [r.video_id, r]));
  } catch (error) {
    logger.warn('[Media] Imported file names unavailable', { error: error instanceof Error ? error.message : String(error) });
    return new Map();
  }
}

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

// ---------------------------------------------------------------------------
// Concurrent R2 transcodes range, autoscaled (apps/media enforces it; shared-types transcode-limit.ts)
// ---------------------------------------------------------------------------

app.get('/transcode-limit', async (c) => {
  const result = await callVideosInternal(c.env, '/internal/media/transcode-limit');
  return c.json({ success: true, result });
});

/**
 * { min, max } whole numbers with 1 ≤ min ≤ max (api-videos checks max against the ceiling too);
 * `undo` marks an Undo of the last change.
 */
export function parseTranscodeLimitInput(body: unknown): { ok: true; min: number; max: number; undo: boolean } | { ok: false; error: string; field?: 'min' | 'max' } {
  const b = (body ?? {}) as { min?: unknown; max?: unknown; undo?: unknown };
  const problem = transcodeRangeProblem(b.min, b.max, null);
  if (problem) return { ok: false, error: `${problem.field}: ${problem.problem}`, field: problem.field };
  // A sanity bound only: api-videos checks max against Cloudflare's limit (MEDIA_TRANSCODE_CEILING)
  if ((b.max as number) > 100_000) return { ok: false, error: 'max: above_ceiling', field: 'max' };
  if (b.undo !== undefined && typeof b.undo !== 'boolean') return { ok: false, error: 'undo must be true or false' };
  return { ok: true, min: b.min as number, max: b.max as number, undo: b.undo === true };
}

app.put('/transcode-limit', async (c) => {
  const parsed = parseTranscodeLimitInput(await c.req.json().catch(() => null));
  if ('error' in parsed) return c.json({ success: false, code: 'bad_request', error: parsed.error, ...(parsed.field ? { field: parsed.field } : {}) }, 400);
  const current = await callVideosInternal<{ min: number; max: number; isDefault: boolean }>(c.env, '/internal/media/transcode-limit');
  const result = await audited(
    c,
    [{ key: TRANSCODE_LIMIT_AUDIT_KEY, oldValue: { min: current.min, max: current.max, isDefault: current.isDefault }, newValue: { min: parsed.min, max: parsed.max, ...(parsed.undo ? { undo: true } : {}) } }],
    () => callVideosInternal(c.env, '/internal/media/transcode-limit', { method: 'PUT', json: { min: parsed.min, max: parsed.max, actorId: actorOf(c) } }),
  );
  logger.info('[Media] Concurrent transcodes range changed', { actorId: actorOf(c), from: `${current.min}-${current.max}`, to: `${parsed.min}-${parsed.max}`, undo: parsed.undo });
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

app.get('/providers', async (c) => {
  const result = await callVideosInternal(c.env, '/internal/media/providers');
  return c.json({ success: true, result });
});

/**
 * Checks a provider settings document before it reaches api-videos (which checks again): an object,
 * and nothing that leaves new uploads unplayable or uses a provider that is off.
 */
export function parseProvidersInput(body: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string; problems?: unknown } {
  const settings = (body as { settings?: unknown } | null)?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { ok: false, error: 'settings must be an object' };
  if (JSON.stringify(settings).length > 64_000) return { ok: false, error: 'settings are too large' };
  const problems = settingsProblems(normaliseMediaSettings({ ...(settings as object), version: 2 }));
  if (problems.length) return { ok: false, error: 'These settings would leave videos unplayable', problems };
  return { ok: true, value: settings as Record<string, unknown> };
}

app.put('/providers', async (c) => {
  const parsed = parseProvidersInput(await c.req.json().catch(() => null));
  if ('error' in parsed) return c.json({ success: false, code: 'bad_request', error: parsed.error, ...(parsed.problems ? { problems: parsed.problems } : {}) }, 400);
  const current = await callVideosInternal<{ settings: Record<string, unknown> }>(c.env, '/internal/media/providers');
  const result = await audited(c, [{ key: MEDIA_SETTINGS_AUDIT_KEY, oldValue: current.settings, newValue: parsed.value }], () =>
    callVideosInternal(c.env, '/internal/media/providers', { method: 'PUT', json: { settings: parsed.value, actorId: actorOf(c) } }),
  );
  logger.info('[Media] Provider settings changed', { actorId: actorOf(c) });
  return c.json({ success: true, result });
});

const VIDEO_ID = /^[A-Za-z0-9-]{8,64}$/;

/** A video's playback override (api-videos checks it against the video's copies and the settings). */
app.put('/videos/:id/override', async (c) => {
  const id = c.req.param('id');
  if (!VIDEO_ID.test(id)) return bad(c, 'bad video id');
  const body = (await c.req.json().catch(() => null)) as { override?: unknown } | null;
  const override = body?.override;
  if (override !== null && (!override || typeof override !== 'object' || Array.isArray(override))) return bad(c, 'override must be an object or null');
  if (override && JSON.stringify(override).length > 4_000) return bad(c, 'override is too large');
  const result = await audited(c, [{ key: `${MEDIA_VIDEO_AUDIT_PREFIX}${id}`, oldValue: undefined, newValue: { action: 'playback_override', override } }], () =>
    callVideosInternal(c.env, `/internal/media/videos/${encodeURIComponent(id)}/override`, { method: 'PUT', json: { override, actorId: actorOf(c) } }),
  );
  logger.info('[Media] Video playback override changed', { videoId: id, actorId: actorOf(c), cleared: override === null });
  return c.json({ success: true, result });
});

app.post('/health/check', async (c) => {
  const result = await callVideosInternal(c.env, '/internal/media/health/check', { method: 'POST', json: {} });
  return c.json({ success: true, result });
});

// ---------------------------------------------------------------------------
// R2 backfill of existing videos and Bunny retirement (api-videos /internal/media/backfill/*,
// docs/media-delivery/BACKFILL.md). Reads pass through; every change is audited first.
// ---------------------------------------------------------------------------

export const MEDIA_BACKFILL_AUDIT_PREFIX = 'media:backfill:';
export const MEDIA_BUNNY_RETIRE_AUDIT_PREFIX = 'media:bunny-retire:';
const RUN_ID = /^[A-Za-z0-9-]{8,64}$/;
const BF = '/internal/media/backfill';

const passQuery = (c: C, names: string[]) => Object.fromEntries(names.map((n) => [n, c.req.query(n)]).filter(([, v]) => v)) as Record<string, string>;

app.get('/backfill/overview', async (c) => c.json({ success: true, result: await callVideosInternal(c.env, `${BF}/overview`) }));

app.get('/backfill/runs', async (c) => c.json({ success: true, result: await callVideosInternal(c.env, `${BF}/runs`, { query: passQuery(c, ['limit']) }) }));

app.post('/backfill/runs', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { scope?: unknown };
  if (!body.scope || typeof body.scope !== 'object' || JSON.stringify(body.scope).length > 40_000) return bad(c, 'scope must be an object');
  const result = await audited(c, [{ key: `${MEDIA_BACKFILL_AUDIT_PREFIX}new`, oldValue: undefined, newValue: { action: 'estimate', scope: body.scope } }], () =>
    callVideosInternal<{ run: { id: string } }>(c.env, `${BF}/runs`, { method: 'POST', json: { scope: body.scope, actorId: actorOf(c) } }),
  );
  logger.info('[Media] Backfill estimate requested', { actorId: actorOf(c), runId: result.run?.id });
  return c.json({ success: true, result }, 201);
});

app.get('/backfill/runs/:id', async (c) => {
  const id = c.req.param('id');
  if (!RUN_ID.test(id)) return bad(c, 'bad run id');
  return c.json({ success: true, result: await callVideosInternal(c.env, `${BF}/runs/${id}`) });
});

app.get('/backfill/runs/:id/items', async (c) => {
  const id = c.req.param('id');
  if (!RUN_ID.test(id)) return bad(c, 'bad run id');
  return c.json({ success: true, result: await callVideosInternal(c.env, `${BF}/runs/${id}/items`, { query: passQuery(c, ['state', 'cursor', 'limit']) }) });
});

app.put('/backfill/runs/:id/settings', async (c) => {
  const id = c.req.param('id');
  if (!RUN_ID.test(id)) return bad(c, 'bad run id');
  const body = (await c.req.json().catch(() => ({}))) as { settings?: unknown };
  if (!body.settings || typeof body.settings !== 'object') return bad(c, 'settings must be an object');
  const result = await audited(c, [{ key: `${MEDIA_BACKFILL_AUDIT_PREFIX}${id}`, oldValue: undefined, newValue: { action: 'settings', settings: body.settings } }], () =>
    callVideosInternal(c.env, `${BF}/runs/${id}/settings`, { method: 'PUT', json: { settings: body.settings } }),
  );
  return c.json({ success: true, result });
});

app.post('/backfill/runs/:id/:action{start|pause|cancel|retry-failed}', async (c) => {
  const id = c.req.param('id');
  const action = c.req.param('action');
  if (!RUN_ID.test(id)) return bad(c, 'bad run id');
  const result = await audited(c, [{ key: `${MEDIA_BACKFILL_AUDIT_PREFIX}${id}`, oldValue: undefined, newValue: { action } }], () =>
    callVideosInternal(c.env, `${BF}/runs/${id}/${action}`, { method: 'POST', json: {} }),
  );
  logger.info('[Media] Backfill run action', { runId: id, action, actorId: actorOf(c) });
  return c.json({ success: true, result });
});

app.post('/backfill/items/retry', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { runId?: unknown; videoId?: unknown };
  if (typeof body.runId !== 'string' || !RUN_ID.test(body.runId) || typeof body.videoId !== 'string' || !VIDEO_ID.test(body.videoId)) return bad(c, 'runId and videoId are required');
  const result = await audited(c, [{ key: `${MEDIA_BACKFILL_AUDIT_PREFIX}${body.runId}`, oldValue: undefined, newValue: { action: 'retry_item', videoId: body.videoId } }], () =>
    callVideosInternal(c.env, `${BF}/items/retry`, { method: 'POST', json: { runId: body.runId, videoId: body.videoId } }),
  );
  return c.json({ success: true, result });
});

/** Play R2 first: per video (verified only), per channel or everywhere, through the provider settings. */
app.post('/backfill/flip', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { target?: unknown; videoIds?: unknown; channelId?: unknown; undo?: unknown };
  const undo = body.undo === true;
  let rows: { key: string; oldValue: unknown; newValue: unknown }[];
  if (body.target === 'videos') {
    const ids = Array.isArray(body.videoIds) ? body.videoIds : [];
    if (!ids.length || ids.length > 200 || !ids.every((v) => typeof v === 'string' && VIDEO_ID.test(v))) return bad(c, 'videoIds must list 1-200 video ids');
    rows = (ids as string[]).map((v) => ({ key: `${MEDIA_VIDEO_AUDIT_PREFIX}${v}`, oldValue: undefined, newValue: { action: undo ? 'r2_first_undo' : 'r2_first' } }));
  } else if (body.target === 'channel' || body.target === 'global') {
    if (body.target === 'channel' && (typeof body.channelId !== 'string' || !VIDEO_ID.test(body.channelId))) return bad(c, 'channelId is required');
    const current = await callVideosInternal<{ settings: Record<string, unknown> }>(c.env, '/internal/media/providers');
    rows = [{ key: MEDIA_SETTINGS_AUDIT_KEY, oldValue: current.settings, newValue: { action: undo ? 'r2_first_undo' : 'r2_first', target: body.target, channelId: body.channelId } }];
  } else return bad(c, 'target must be videos, channel or global');
  const result = await audited(c, rows, () =>
    callVideosInternal(c.env, `${BF}/flip`, { method: 'POST', json: { target: body.target, videoIds: body.videoIds, channelId: body.channelId, undo, actorId: actorOf(c) } }),
  );
  logger.info('[Media] Backfill flip', { target: body.target, undo, actorId: actorOf(c) });
  return c.json({ success: true, result });
});

app.get('/backfill/channels/:id/verification', async (c) => {
  const id = c.req.param('id');
  if (!VIDEO_ID.test(id)) return bad(c, 'bad channel id');
  return c.json({ success: true, result: await callVideosInternal(c.env, `${BF}/channels/${id}/verification`) });
});

app.get('/backfill/libraries', async (c) => c.json({ success: true, result: await callVideosInternal(c.env, `${BF}/libraries`) }));

app.get('/backfill/libraries/:id/removals', async (c) => {
  const id = c.req.param('id');
  if (!/^\d{1,12}$/.test(id)) return bad(c, 'bad library id');
  return c.json({ success: true, result: await callVideosInternal(c.env, `${BF}/libraries/${id}/removals`, { query: passQuery(c, ['status', 'cursor', 'limit']) }) });
});

/** Retire a library: schedule the removal of its verified videos after the grace period. Needs the typed confirmation. */
app.post('/backfill/libraries/:id/removals', async (c) => {
  const id = c.req.param('id');
  if (!/^\d{1,12}$/.test(id)) return bad(c, 'bad library id');
  const body = (await c.req.json().catch(() => ({}))) as { graceDays?: unknown; confirm?: unknown };
  if (body.confirm !== id) return bad(c, 'Type the library id to confirm');
  if (typeof body.graceDays !== 'number') return bad(c, 'graceDays is required');
  const result = await audited(c, [{ key: `${MEDIA_BUNNY_RETIRE_AUDIT_PREFIX}${id}`, oldValue: undefined, newValue: { action: 'schedule_removals', graceDays: body.graceDays } }], () =>
    callVideosInternal(c.env, `${BF}/libraries/${id}/removals`, { method: 'POST', json: { graceDays: body.graceDays, actorId: actorOf(c) } }),
  );
  logger.warn('[Media] Bunny library removals scheduled', { libraryId: id, graceDays: body.graceDays, actorId: actorOf(c) });
  return c.json({ success: true, result });
});

app.post('/backfill/libraries/:id/removals/cancel', async (c) => {
  const id = c.req.param('id');
  if (!/^\d{1,12}$/.test(id)) return bad(c, 'bad library id');
  const result = await audited(c, [{ key: `${MEDIA_BUNNY_RETIRE_AUDIT_PREFIX}${id}`, oldValue: undefined, newValue: { action: 'cancel_removals' } }], () =>
    callVideosInternal(c.env, `${BF}/libraries/${id}/removals/cancel`, { method: 'POST', json: {} }),
  );
  return c.json({ success: true, result });
});

app.post('/backfill/removals/retry', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { videoId?: unknown };
  if (typeof body.videoId !== 'string' || !VIDEO_ID.test(body.videoId)) return bad(c, 'videoId is required');
  const result = await audited(c, [{ key: `${MEDIA_VIDEO_AUDIT_PREFIX}${body.videoId}`, oldValue: undefined, newValue: { action: 'bunny_removal_retry' } }], () =>
    callVideosInternal(c.env, `${BF}/removals/retry`, { method: 'POST', json: { videoId: body.videoId } }),
  );
  return c.json({ success: true, result });
});

export default app;
