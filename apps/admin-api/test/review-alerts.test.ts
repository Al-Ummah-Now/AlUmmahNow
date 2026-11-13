/**
 * /api/review-alerts: the Admin app's on-call rota and escalation settings (audited, admins
 * change them), the review timings and the staff device list / sign-out through the processor.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { REVIEW_ALERT_SETTINGS_KEY } from '@al-ummah/shared-types';
import router from '../src/routers/reviewAlerts.router';
import { sqliteD1 } from './d1-sqlite';

const RIYADH_EVENINGS = { userId: 'rev-1', senior: false, timeZone: 'Asia/Riyadh', shifts: [{ days: [0, 1, 2, 3, 4], start: '18:00', end: '23:00' }] };
const SETTINGS = { enabled: true, escalateAllAfterSeconds: 120, escalateSeniorsAfterSeconds: 240, owners: ['owner-1'], rota: [RIYADH_EVENINGS] };

function setup(roles: string[], processor: (path: string, method: string) => Response = () => new Response('{}')) {
  const calls: Array<{ path: string; method: string; key: string | null }> = [];
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    PROCESSOR: {
      async fetch(input: string, init?: RequestInit) {
        const u = new URL(input);
        calls.push({ path: `${u.pathname}${u.search}`, method: init?.method ?? 'GET', key: new Headers(init?.headers).get('X-API-Key') });
        return processor(`${u.pathname}${u.search}`, init?.method ?? 'GET');
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles } as never);
    await next();
  });
  app.route('/api/review-alerts', router);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  return { req, env, calls };
}
const put = (json: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });

describe('/api/review-alerts/settings', () => {
  it('starts with the defaults: 2 and 4 minutes, nobody on the rota', async () => {
    const { req } = setup(['moderator']);
    const body = (await (await req('/api/review-alerts/settings')).json()) as any;
    assert.deepEqual(body.result.settings, { enabled: true, escalateAllAfterSeconds: 120, escalateSeniorsAfterSeconds: 240, owners: [], rota: [] });
    assert.equal(body.result.canManage, false);
  });

  it('moderators read, only admins change; every change is audited and returns the previous value for undo', async () => {
    const { req, env } = setup(['Admin']);
    assert.equal((await setup(['moderator']).req('/api/review-alerts/settings', put(SETTINGS))).status, 403);
    const res = await req('/api/review-alerts/settings', put(SETTINGS));
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.changed, true);
    assert.deepEqual(body.result.previous.rota, []);
    const stored = await env.REPORTS_DB.prepare('SELECT value, updated_by FROM site_settings WHERE key = ?').bind(REVIEW_ALERT_SETTINGS_KEY).first<any>();
    assert.deepEqual(JSON.parse(stored.value), SETTINGS);
    assert.equal(stored.updated_by, 'admin-1');
    // Undo = put the previous value back; a no-op writes nothing
    assert.equal(((await (await req('/api/review-alerts/settings', put(SETTINGS))).json()) as any).changed, false);
    await req('/api/review-alerts/settings', put(body.result.previous));
    const history = (await (await req('/api/review-alerts/history')).json()) as any;
    assert.equal(history.result.entries.length, 2);
  });

  it('rejects bad settings with a reason', async () => {
    const { req } = setup(['super_admin']);
    for (const bad of [{ ...SETTINGS, escalateSeniorsAfterSeconds: 100 }, { ...SETTINGS, rota: [{ ...RIYADH_EVENINGS, timeZone: 'Nowhere/City' }] }, { ...SETTINGS, enabled: 'yes' }, null]) {
      const res = await req('/api/review-alerts/settings', put(bad));
      assert.equal(res.status, 400);
      assert.ok(((await res.json()) as any).error);
    }
  });
});

describe('/api/review-alerts/devices', () => {
  it('lists a staff member’s devices through the processor (admins only)', async () => {
    const { req, calls } = setup(['admin'], () => new Response(JSON.stringify({ devices: [{ installId: 'install-1', app: 'admin', tokenHint: '…abc' }] })));
    const body = (await (await req('/api/review-alerts/devices?userId=rev-1')).json()) as any;
    assert.deepEqual(body.result.devices, [{ installId: 'install-1', app: 'admin', tokenHint: '…abc' }]);
    assert.deepEqual(calls, [{ path: '/internal/push-devices?userId=rev-1', method: 'GET', key: 'k' }]);
    assert.equal((await setup(['moderator']).req('/api/review-alerts/devices?userId=rev-1')).status, 403);
    assert.equal((await req('/api/review-alerts/devices')).status, 400);
  });

  it('signs out one device: the processor deletes the push row and the action is audited', async () => {
    const { req, calls, env } = setup(['admin'], (_p, method) => new Response(JSON.stringify({ deleted: method === 'DELETE' }), { status: 200 }));
    const res = await req('/api/review-alerts/devices/install-1234?userId=rev-1', { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.deepEqual(calls.at(-1), { path: '/internal/push-devices/install-1234?userId=rev-1', method: 'DELETE', key: 'k' });
    const audit = await env.REPORTS_DB.prepare("SELECT action, target_id, metadata FROM admin_audit_log").first<any>();
    assert.deepEqual({ ...audit }, { action: 'staff_device_signed_out', target_id: 'rev-1', metadata: '{"installId":"install-1234"}' });
  });

  it('a device that is not that user’s is a 404 and is not audited', async () => {
    const { req, env } = setup(['admin'], () => new Response('{"deleted":false}', { status: 404 }));
    assert.equal((await req('/api/review-alerts/devices/install-1234?userId=rev-1', { method: 'DELETE' })).status, 404);
    assert.equal((await env.REPORTS_DB.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').first<any>()).n, 0);
  });
});

describe('/api/review-alerts/stats', () => {
  it('passes the day range to the processor and fails cleanly when it is down', async () => {
    const { req, calls } = setup(['moderator'], () => new Response(JSON.stringify({ days: [{ day: '2026-11-13', held: 3 }] })));
    const body = (await (await req('/api/review-alerts/stats?days=500')).json()) as any;
    assert.deepEqual(body.result.days, [{ day: '2026-11-13', held: 3 }]);
    assert.equal(calls[0].path, '/internal/review-alerts/stats?days=90');
    const down = setup(['moderator'], () => new Response('{}', { status: 503 }));
    assert.equal((await down.req('/api/review-alerts/stats')).status, 502);
  });
});
