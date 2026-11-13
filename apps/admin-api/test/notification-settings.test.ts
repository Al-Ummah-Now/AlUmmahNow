/**
 * /api/notification-settings: what opening the notification menu does. Admins change it
 * (settings:manage), every change is audited first and the audit row dropped if api-videos fails.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import router, { NOTIFICATION_MENU_AUDIT_KEY } from '../src/routers/notificationSettings.router';
import { hasPermission } from '../src/lib/roles';
import { sqliteD1 } from './d1-sqlite';

function setup(roles: string[], fail = false) {
  let stored = { menuOpen: 'seen', updatedAt: null as string | null, updatedBy: null as string | null };
  const calls: { method: string; body: any; key: string | null }[] = [];
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(_input: string, init?: RequestInit) {
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ method, body, key: new Headers(init?.headers).get('X-API-Key') });
        if (method === 'PUT') {
          if (fail) return new Response(JSON.stringify({ success: false, error: 'boom' }), { status: 500 });
          stored = { menuOpen: body.menuOpen, updatedAt: 'now', updatedBy: body.actorId };
        }
        return new Response(JSON.stringify({ success: true, result: stored }), { status: 200 });
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles } as never);
    await next();
  });
  app.route('/api/notification-settings', router);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const audit = async () => ((await env.REPORTS_DB.prepare('SELECT key, old_value, new_value, actor_id FROM site_settings_log').all<any>()).results ?? []).map((r: any) => ({ ...r }));
  return { req, calls, audit };
}

const put = (json: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });

describe('/api/notification-settings', () => {
  it('settings:manage is for admins and super admins', () => {
    assert.equal(hasPermission(['Admin'], 'settings:manage'), true);
    assert.equal(hasPermission(['Super Admin'], 'settings:manage'), true);
    assert.equal(hasPermission(['Moderator'], 'settings:manage'), false);
  });

  it('lets moderators read but not change it', async () => {
    const { req, calls, audit } = setup(['moderator']);
    assert.equal(((await (await req('/api/notification-settings')).json()) as any).result.menuOpen, 'seen');
    assert.equal((await req('/api/notification-settings', put({ menuOpen: 'read' }))).status, 403);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
    assert.deepEqual(await audit(), []);
  });

  it('changes it with an audit row and the actor, ignoring a no-op and bad values', async () => {
    const { req, calls, audit } = setup(['admin']);
    assert.equal((await req('/api/notification-settings', put({ menuOpen: 'loud' }))).status, 400);
    const res = (await (await req('/api/notification-settings', put({ menuOpen: 'read' }))).json()) as any;
    assert.equal(res.changed, true);
    assert.equal(res.result.menuOpen, 'read');
    assert.deepEqual(calls.at(-1)!.body, { menuOpen: 'read', actorId: 'admin-1' });
    assert.equal(calls.at(-1)!.key, 'k');
    assert.deepEqual(await audit(), [{ key: NOTIFICATION_MENU_AUDIT_KEY, old_value: 'seen', new_value: 'read', actor_id: 'admin-1' }]);
    const again = (await (await req('/api/notification-settings', put({ menuOpen: 'read' }))).json()) as any;
    assert.equal(again.changed, false);
    assert.equal((await audit()).length, 1);
    const history = (await (await req('/api/notification-settings/history')).json()) as any;
    assert.equal(history.result.entries[0].newValue, 'read');
  });

  it('drops the audit row when api-videos fails', async () => {
    const { req, audit } = setup(['super_admin'], true);
    assert.equal((await req('/api/notification-settings', put({ menuOpen: 'read' }))).status, 500);
    assert.deepEqual(await audit(), []);
  });
});
