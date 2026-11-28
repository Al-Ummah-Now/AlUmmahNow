import { Hono } from 'hono';
import type { QafSettings } from '@al-ummah/shared-types';
import type { AdminBindings, AuthContext } from '../base/types';
import { logger } from '../lib/logger';
import { callVideosInternal, ProcessingApiError } from '../lib/processing/videosProcessing';
import { auditOriginJson } from '../lib/request-origin';
import { hasPermission } from '../lib/roles';

const router = new Hono<{ Bindings: AdminBindings; Variables: { auth?: AuthContext } }>();
const path = '/internal/qaf';

router.use('*', async (c, next) => {
  if (!hasPermission(c.get('auth')?.roles, 'sources:manage')) return c.json({ error: 'forbidden' }, 403);
  return next();
});

router.onError((error, c) => {
  if (error instanceof ProcessingApiError && error.status === 400) return c.json({ error: 'invalid_request' }, 400);
  logger.error('[Qaf] Videos platform settings request failed', { method: c.req.method });
  return c.json({ error: 'unavailable' }, 503);
});

router.get('/', async (c) => c.json({ success: true, result: await callVideosInternal<QafSettings>(c.env, path) }));

router.put('/', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'invalid_request' }, 400);
  const actor = c.get('auth')?.userId;
  if (!actor) return c.json({ error: 'forbidden' }, 403);
  const audit = c.env.REPORTS_DB;
  const id = crypto.randomUUID();
  const change = !('key' in body) ? 'limits' : body.key === null ? 'clear' : 'set';
  await audit.prepare(`INSERT INTO site_settings_log (id, key, new_value, actor_id, created_at, origin)
    VALUES (?, 'qaf:sources', ?, ?, ?, ?)`).bind(id, JSON.stringify({ change }), actor, new Date().toISOString(), auditOriginJson()).run();
  try {
    const result = await callVideosInternal<QafSettings>(c.env, path, { method: 'PUT', json: body });
    return c.json({ success: true, result });
  } catch (error) {
    await audit.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(id).run()
      .catch(() => logger.warn('[Qaf] Could not discard the audit entry for a failed settings change'));
    throw error;
  }
});

export default router;
