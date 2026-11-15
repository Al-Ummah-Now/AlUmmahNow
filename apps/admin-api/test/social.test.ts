/**
 * /api/social: social auto-post platform settings (wiki AUN-SOCIAL). Admins change the kill switches, the X cap
 * and the network credentials (settings:manage); every change is audited first, credentials never reach the
 * audit row or the logs, and a failed api-videos call drops the audit row. The Errors page may retry deliveries.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import router, { SOCIAL_SETTINGS_AUDIT_KEY } from '../src/routers/social.router';
import { SERVICE_RETRIES } from '../src/lib/errors-actions';
import { sqliteD1 } from './d1-sqlite';

function setup(roles: string[], status = 200) {
  const calls: { method: string; path: string; body: any; actor: string | null; key: string | null }[] = [];
  let settings: Record<string, unknown> = { enabled: true, networks: {}, xMonthlyCapUsd: 0 };
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const method = init?.method ?? 'GET';
        const path = new URL(input).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        const h = new Headers(init?.headers);
        calls.push({ method, path, body, actor: h.get('X-Admin-Actor'), key: h.get('X-API-Key') });
        if (status !== 200 && method !== 'GET') return new Response(JSON.stringify({ error: 'invalid_credentials' }), { status });
        if (path === '/internal/social/admin') return new Response(JSON.stringify({ settings, readiness: {}, spend: { costMicros: 0 } }));
        if (path === '/internal/social/admin/settings') {
          const before = settings;
          settings = body;
          return new Response(JSON.stringify({ before, settings }));
        }
        return new Response(JSON.stringify({ readiness: { x: { configured: method === 'PUT' } } }));
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles } as never);
    await next();
  });
  app.route('/api/social', router);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const audit = async () => ((await env.REPORTS_DB.prepare('SELECT key, old_value, new_value, actor_id FROM site_settings_log ORDER BY created_at').all<any>()).results ?? []).map((r: any) => ({ ...r }));
  return { req, calls, audit };
}

const send = (method: string, json?: unknown): RequestInit => ({ method, ...(json === undefined ? {} : { body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }) });

describe('/api/social', () => {
  it('moderators read the overview but change nothing', async () => {
    const { req, calls, audit } = setup(['moderator']);
    assert.equal((await req('/api/social')).status, 200);
    assert.equal((await req('/api/social/settings', send('PUT', { enabled: false }))).status, 403);
    assert.equal((await req('/api/social/credentials/x', send('PUT', { clientId: 'a', clientSecret: 'b' }))).status, 403);
    assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
    assert.deepEqual(await audit(), []);
  });

  it('the kill switch and cap are saved with the actor and an audit row', async () => {
    const { req, calls, audit } = setup(['admin']);
    const res = (await (await req('/api/social/settings', send('PUT', { enabled: false, xMonthlyCapUsd: 25 }))).json()) as any;
    assert.equal(res.result.settings.enabled, false);
    const put = calls.find((c) => c.method === 'PUT')!;
    assert.equal(put.actor, 'admin-1');
    assert.equal(put.key, 'k');
    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, SOCIAL_SETTINGS_AUDIT_KEY);
    assert.deepEqual(JSON.parse(rows[0].new_value), { enabled: false, xMonthlyCapUsd: 25 });
    const history = (await (await req('/api/social/history')).json()) as any;
    assert.equal(history.result.entries.length, 1);
  });

  it('credentials are forwarded field by field and never audited', async () => {
    const { req, calls, audit } = setup(['super_admin']);
    const res = await req('/api/social/credentials/x', send('PUT', { clientId: 'client-123', clientSecret: 'very-secret-value', extra: 'dropped' }));
    assert.equal(res.status, 200);
    assert.deepEqual(calls.at(-1)!.body, { clientId: 'client-123', clientSecret: 'very-secret-value' });
    const rows = await audit();
    assert.equal(rows[0].key, 'social:credentials:x');
    assert.ok(!JSON.stringify(rows).includes('very-secret-value'));
    assert.equal((await req('/api/social/credentials/bluesky', send('PUT', {}))).status, 400);
    assert.equal((await req('/api/social/credentials/telegram', send('DELETE'))).status, 200);
    assert.equal(JSON.parse((await audit())[1].new_value).action, 'cleared');
  });

  it("api-videos' refusal passes through and the audit row is dropped", async () => {
    const { req, audit } = setup(['admin'], 400);
    const res = await req('/api/social/credentials/telegram', send('PUT', { botToken: 'nope' }));
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as any).code, 'invalid_credentials');
    assert.deepEqual(await audit(), []);
  });

  it('the Errors page may retry a social delivery', () => {
    assert.ok(SERVICE_RETRIES['api-videos'].paths.includes('/internal/social/deliveries/retry'));
  });
});
