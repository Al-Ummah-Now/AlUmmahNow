/**
 * Review alerts for the native Admin app (wiki AUN-ADMIN-NATIVE "Alerts and the 5-minute target").
 *
 *   GET  /api/review-alerts/settings          the on-call rota, escalation times and owners
 *   PUT  /api/review-alerts/settings          replace them (review_alerts:manage; audited). The
 *                                             answer carries `previous` so the screen can undo
 *   GET  /api/review-alerts/history?limit=    the latest changes (audit, newest first)
 *   GET  /api/review-alerts/stats?days=14     daily median and p90 from held to alert / open / claim / decision
 *   GET  /api/review-alerts/devices?userId=   a staff member's push devices (staff_devices:manage)
 *   DELETE /api/review-alerts/devices/:installId?userId=   "Sign out this device": the push registration goes
 *
 * The settings live in REPORTS_DB site_settings (key REVIEW_ALERT_SETTINGS_KEY), which the processor's
 * review-alerts consumer reads on every alert. Devices and timings live in the processor's
 * NOTIFICATIONS_DB and are read through the PROCESSOR service binding (/internal/*).
 */
import { Hono, type Context } from 'hono';
import {
  DEFAULT_REVIEW_ALERT_SETTINGS,
  parseReviewAlertSettings,
  REVIEW_ALERT_SETTINGS_KEY,
  validateReviewAlertSettings,
} from '@al-ummah/shared-types';
import { hasPermission } from '../lib/roles';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const USER_ID = /^[A-Za-z0-9_:.@-]{1,128}$/;
const INSTALL_ID = /^[A-Za-z0-9_-]{8,64}$/;

class ProcessorError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function callProcessor<T>(env: AdminBindings, path: string, method = 'GET'): Promise<{ status: number; body: T }> {
  const binding = env.INTERNAL_API_KEY;
  const key = typeof binding === 'string' ? binding : await binding?.get();
  if (!key) throw new ProcessorError(500, 'INTERNAL_API_KEY is not configured');
  if (!env.PROCESSOR) throw new ProcessorError(503, 'The PROCESSOR service binding is not configured');
  const res = await env.PROCESSOR.fetch(`https://processor.internal${path}`, { method, headers: { 'X-API-Key': key } });
  const body = (await res.json().catch(() => null)) as T;
  if (!res.ok && res.status !== 404) throw new ProcessorError(res.status >= 500 ? 502 : res.status, `processor answered ${res.status}`);
  return { status: res.status, body };
}

app.onError((error, c) => {
  if (error instanceof ProcessorError) return c.json({ success: false, code: 'processor_error', error: error.message }, error.status as 502);
  logger.error('[ReviewAlerts] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

async function readSettings(env: AdminBindings) {
  const row = await env.REPORTS_DB.prepare('SELECT value, updated_by, updated_at FROM site_settings WHERE key = ?')
    .bind(REVIEW_ALERT_SETTINGS_KEY)
    .first<{ value: string; updated_by: string; updated_at: string }>();
  return { settings: row ? parseReviewAlertSettings(row.value) : DEFAULT_REVIEW_ALERT_SETTINGS, updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at ?? null, stored: row?.value ?? null };
}

app.get('/settings', async (c) => {
  const { settings, updatedBy, updatedAt } = await readSettings(c.env);
  return c.json({ success: true, result: { settings, updatedBy, updatedAt, canManage: hasPermission(c.get('auth')?.roles, 'review_alerts:manage') } });
});

app.put('/settings', async (c) => {
  if (!hasPermission(c.get('auth')?.roles, 'review_alerts:manage')) {
    logger.warn('[ReviewAlerts] Permission denied', { userId: actorOf(c) });
    return c.json({ success: false, code: 'forbidden', error: 'The review_alerts:manage permission is required' }, 403);
  }
  const checked = validateReviewAlertSettings(await c.req.json().catch(() => null));
  if ('error' in checked) return c.json({ success: false, code: 'bad_request', error: checked.error }, 400);
  const current = await readSettings(c.env);
  const next = JSON.stringify(checked.value);
  if (current.stored === next) return c.json({ success: true, changed: false, result: { settings: checked.value, previous: current.settings } });
  const now = new Date().toISOString();
  const db = c.env.REPORTS_DB;
  await db.batch([
    db.prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), REVIEW_ALERT_SETTINGS_KEY, current.stored, next, actorOf(c), now),
    db.prepare(
      `INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(REVIEW_ALERT_SETTINGS_KEY, next, actorOf(c), now),
  ]);
  logger.info('[ReviewAlerts] Settings changed', { actorId: actorOf(c), reviewers: checked.value.rota.length, enabled: checked.value.enabled });
  return c.json({ success: true, changed: true, result: { settings: checked.value, previous: current.settings, updatedAt: now, updatedBy: actorOf(c) } });
});

app.get('/history', async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10', 10) || 10, 1), 50);
  const { results } = await c.env.REPORTS_DB
    .prepare('SELECT id, actor_id, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(REVIEW_ALERT_SETTINGS_KEY, limit)
    .all<{ id: string; actor_id: string; created_at: string }>();
  return c.json({ success: true, result: { entries: (results ?? []).map((r) => ({ id: r.id, actorId: r.actor_id, createdAt: r.created_at })) } });
});

app.get('/stats', async (c) => {
  const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') || '14', 10) || 14));
  const { body } = await callProcessor<{ days: unknown[] }>(c.env, `/internal/review-alerts/stats?days=${days}`);
  return c.json({ success: true, result: body });
});

app.get('/devices', async (c) => {
  if (!hasPermission(c.get('auth')?.roles, 'staff_devices:manage')) return c.json({ success: false, code: 'forbidden', error: 'The staff_devices:manage permission is required' }, 403);
  const userId = c.req.query('userId') ?? '';
  if (!USER_ID.test(userId)) return c.json({ success: false, code: 'bad_request', error: 'userId is required' }, 400);
  const { body } = await callProcessor<{ devices: unknown[] }>(c.env, `/internal/push-devices?userId=${encodeURIComponent(userId)}`);
  return c.json({ success: true, result: { devices: body.devices ?? [] } });
});

app.delete('/devices/:installId', async (c) => {
  if (!hasPermission(c.get('auth')?.roles, 'staff_devices:manage')) return c.json({ success: false, code: 'forbidden', error: 'The staff_devices:manage permission is required' }, 403);
  const userId = c.req.query('userId') ?? '';
  const installId = c.req.param('installId');
  if (!USER_ID.test(userId) || !INSTALL_ID.test(installId)) return c.json({ success: false, code: 'bad_request', error: 'userId and installId are required' }, 400);
  const { status } = await callProcessor(c.env, `/internal/push-devices/${encodeURIComponent(installId)}?userId=${encodeURIComponent(userId)}`, 'DELETE');
  if (status === 404) return c.json({ success: false, code: 'not_found', error: 'No such device for this user' }, 404);
  await c.env.REPORTS_DB.prepare('INSERT INTO admin_audit_log (id, actor_id, actor_email, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), actorOf(c), null, 'staff_device_signed_out', 'user', userId, JSON.stringify({ installId }), new Date().toISOString())
    .run();
  logger.info('[ReviewAlerts] Staff device signed out', { actorId: actorOf(c), userId, installId });
  return c.json({ success: true, result: { installId } });
});

export default app;
