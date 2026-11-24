/**
 * /api/download-rate-limit — platform download rate-limit settings (videos admin → Platform settings).
 *
 *   GET  /          { perDay, burstPerMinute, updatedAt, updatedBy }
 *   PUT  /          { perDay, burstPerMinute }  (settings:manage; audited in site_settings_log)
 *   GET  /history   the latest changes (audit log, newest first)
 */
import { Hono, type Context } from 'hono';
import {
  DOWNLOAD_RATE_LIMIT_AUDIT_KEY,
  validateDownloadRateLimit,
  type DownloadRateLimitSettings,
} from '@al-ummah/shared-types';
import { hasPermission } from '../lib/roles';
import { callVideosInternal, ProcessingApiError, type ProcessingClientEnv } from '../lib/processing/videosProcessing';
import { logger } from '../lib/logger';
import { apiError } from '../lib/api-error';
import type { AdminBindings, AuthContext } from '../base/types';
import { auditOriginJson } from '../lib/request-origin';

type Env = { Bindings: AdminBindings & ProcessingClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const INTERNAL_PATH = '/internal/downloads/rate-limit';

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';

function formatSummary(v: Pick<DownloadRateLimitSettings, 'perDay' | 'burstPerMinute'>): string {
  return JSON.stringify({ perDay: v.perDay, burstPerMinute: v.burstPerMinute });
}

app.onError((error, c) => {
  if (error instanceof ProcessingApiError) {
    const status = (error.status >= 400 && error.status < 600 ? error.status : 502) as 400;
    return apiError(c, status, 'videos_error', { error: error.message });
  }
  logger.error('[DownloadRateLimit] Request failed', {
    path: c.req.path,
    error: error instanceof Error ? error.message : String(error),
  });
  return apiError(c, 500, 'internal_error', { error: 'Internal error' });
});

app.get('/', async (c) => {
  const result = await callVideosInternal<DownloadRateLimitSettings>(c.env, INTERNAL_PATH);
  return c.json({ success: true, result });
});

app.get('/history', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10', 10) || 10, 1), 50);
  const { results } = await c.env.REPORTS_DB
    .prepare(
      'SELECT id, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
    )
    .bind(DOWNLOAD_RATE_LIMIT_AUDIT_KEY, limit)
    .all<{ id: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }>();
  const entries = (results ?? []).map((r) => ({
    id: r.id,
    oldValue: r.old_value,
    newValue: r.new_value,
    actorId: r.actor_id,
    createdAt: r.created_at,
  }));
  return c.json({ success: true, result: { entries } });
});

app.put('/', async (c) => {
  if (!hasPermission(c.get('auth')?.roles, 'settings:manage')) {
    logger.warn('[DownloadRateLimit] Permission denied', { userId: actorOf(c) });
    return apiError(c, 403, 'forbidden', { error: 'The settings:manage permission is required' });
  }
  const body = (await c.req.json().catch(() => ({}))) as { perDay?: unknown; burstPerMinute?: unknown };
  const parsed = validateDownloadRateLimit({ perDay: body.perDay, burstPerMinute: body.burstPerMinute });
  if ('error' in parsed) {
    const err = parsed.error;
    const error =
      err.reason === 'exceeds_per_day'
        ? 'burstPerMinute must not exceed perDay'
        : `${err.field} must be a whole number from ${err.min} to ${err.max}`;
    return apiError(c, 400, 'invalid_request', { error });
  }
  const value = parsed.value;

  const current = await callVideosInternal<DownloadRateLimitSettings>(c.env, INTERNAL_PATH);
  if (current.perDay === value.perDay && current.burstPerMinute === value.burstPerMinute) {
    return c.json({ success: true, changed: false, result: current });
  }

  const db = c.env.REPORTS_DB;
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      id,
      DOWNLOAD_RATE_LIMIT_AUDIT_KEY,
      formatSummary(current),
      formatSummary(value),
      actorOf(c),
      new Date().toISOString(),
      auditOriginJson(),
    )
    .run();
  let result: DownloadRateLimitSettings;
  try {
    result = await callVideosInternal<DownloadRateLimitSettings>(c.env, INTERNAL_PATH, {
      method: 'PUT',
      json: { ...value, actorId: actorOf(c) },
    });
  } catch (error) {
    // Only delete the audit row when api-videos explicitly refused the request (4xx, before any R2 write).
    // On 5xx or transport/timeout errors the R2 write may already have succeeded, so keep the row marked failed
    // rather than erasing the audit trail.
    if (error instanceof ProcessingApiError && error.status >= 400 && error.status < 500) {
      await db
        .prepare('DELETE FROM site_settings_log WHERE id = ?')
        .bind(id)
        .run()
        .catch((dropError) =>
          logger.error('[DownloadRateLimit] Could not drop the audit row of a rejected change', { error: String(dropError) }),
        );
    } else {
      await db
        .prepare('UPDATE site_settings_log SET new_value = ? WHERE id = ?')
        .bind(JSON.stringify({ perDay: value.perDay, burstPerMinute: value.burstPerMinute, failed: true }), id)
        .run()
        .catch((markError) =>
          logger.error('[DownloadRateLimit] Could not mark the audit row failed', { error: String(markError) }),
        );
    }
    throw error;
  }
  logger.info('[DownloadRateLimit] Settings changed', {
    actorId: actorOf(c),
    from: { perDay: current.perDay, burstPerMinute: current.burstPerMinute },
    to: value,
  });
  return c.json({ success: true, changed: true, result });
});

export default app;
