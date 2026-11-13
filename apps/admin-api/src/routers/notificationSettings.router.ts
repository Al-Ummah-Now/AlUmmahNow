/**
 * /api/notification-settings — platform notification settings (videos admin → Platform settings).
 *
 *   GET  /          { menuOpen, updatedAt, updatedBy }: what opening the notification menu does
 *   PUT  /          { menuOpen: 'seen' | 'read' }  (settings:manage: admins and super admins; audited)
 *   GET  /history   the latest changes (audit log, newest first)
 *
 * The value lives in api-videos (global_settings/ops/notifications.json, read on every bell
 * request through a 30 s cache). The audit row (site_settings_log, key notifications:menu-open)
 * is written before calling api-videos and removed again if that call fails.
 */
import { Hono, type Context } from 'hono';
import { isNotificationMenuOpenMode } from '@al-ummah/shared-types';
import { hasPermission } from '../lib/roles';
import { callVideosInternal, ProcessingApiError, type ProcessingClientEnv } from '../lib/processing/videosProcessing';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & ProcessingClientEnv; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const NOTIFICATION_MENU_AUDIT_KEY = 'notifications:menu-open';
const INTERNAL_PATH = '/internal/notifications/settings';

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';

app.onError((error, c) => {
  if (error instanceof ProcessingApiError) {
    return c.json({ success: false, code: 'videos_error', error: error.message }, error.status as 400);
  }
  logger.error('[NotificationSettings] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

app.get('/', async (c) => {
  const result = await callVideosInternal(c.env, INTERNAL_PATH);
  return c.json({ success: true, result });
});

app.get('/history', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10', 10) || 10, 1), 50);
  const { results } = await c.env.REPORTS_DB
    .prepare('SELECT id, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(NOTIFICATION_MENU_AUDIT_KEY, limit)
    .all<{ id: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }>();
  const entries = (results ?? []).map((r) => ({ id: r.id, oldValue: r.old_value, newValue: r.new_value, actorId: r.actor_id, createdAt: r.created_at }));
  return c.json({ success: true, result: { entries } });
});

app.put('/', async (c) => {
  if (!hasPermission(c.get('auth')?.roles, 'settings:manage')) {
    logger.warn('[NotificationSettings] Permission denied', { userId: actorOf(c) });
    return c.json({ success: false, code: 'forbidden', error: 'The settings:manage permission is required' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { menuOpen?: unknown };
  if (!isNotificationMenuOpenMode(body.menuOpen)) return c.json({ success: false, code: 'bad_request', error: 'menuOpen must be seen or read' }, 400);
  const current = await callVideosInternal<{ menuOpen: string }>(c.env, INTERNAL_PATH);
  if (current.menuOpen === body.menuOpen) return c.json({ success: true, changed: false, result: current });

  const db = c.env.REPORTS_DB;
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, NOTIFICATION_MENU_AUDIT_KEY, current.menuOpen, body.menuOpen, actorOf(c), new Date().toISOString())
    .run();
  try {
    const result = await callVideosInternal(c.env, INTERNAL_PATH, { method: 'PUT', json: { menuOpen: body.menuOpen, actorId: actorOf(c) } });
    logger.info('[NotificationSettings] Menu-open behaviour changed', { actorId: actorOf(c), from: current.menuOpen, to: body.menuOpen });
    return c.json({ success: true, changed: true, result });
  } catch (error) {
    await db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(id).run().catch((dropError) =>
      logger.error('[NotificationSettings] Could not drop the audit row of a failed change', { error: String(dropError) }),
    );
    throw error;
  }
});

export default app;
