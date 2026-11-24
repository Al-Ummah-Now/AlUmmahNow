/**
 * /api/download-rate-limit: admin-configurable per-user download request rate limit (E14-D2).
 * Admins change it (settings:manage), every change is audited first and the audit row dropped if api-videos fails.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { DOWNLOAD_RATE_LIMIT_AUDIT_KEY } from '@al-ummah/shared-types';
import router from '../src/routers/downloadRateLimit.router';
import { sqliteD1 } from './d1-sqlite';

function setup(roles: string[], failStatus: number | false = false) {
  let stored = {
    perDay: 100,
    burstPerMinute: 10,
    updatedAt: null as string | null,
    updatedBy: null as string | null,
  };
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
          if (failStatus) return new Response(JSON.stringify({ success: false, error: 'boom' }), { status: failStatus });
          stored = { perDay: body.perDay, burstPerMinute: body.burstPerMinute, updatedAt: 'now', updatedBy: body.actorId };
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
  app.route('/api/download-rate-limit', router);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const audit = async () =>
    ((await env.REPORTS_DB.prepare('SELECT key, old_value, new_value, actor_id FROM site_settings_log').all<any>()).results ?? []).map(
      (r: any) => ({ ...r }),
    );
  return { req, calls, audit };
}

const put = (json: unknown): RequestInit => ({
  method: 'PUT',
  body: JSON.stringify(json),
  headers: { 'Content-Type': 'application/json' },
});

describe('/api/download-rate-limit (E14-D2)', () => {
  it('lets moderators read but forbids changes', async () => {
    const { req, calls, audit } = setup(['moderator']);
    const got = (await (await req('/api/download-rate-limit')).json()) as any;
    assert.equal(got.result.perDay, 100);
    assert.equal(got.result.burstPerMinute, 10);
    assert.equal((await req('/api/download-rate-limit', put({ perDay: 200, burstPerMinute: 20 }))).status, 403);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
    assert.deepEqual(await audit(), []);
  });

  it('validates bounds, records audit history, and skips no-op updates', async () => {
    const { req, calls, audit } = setup(['admin']);
    assert.equal((await req('/api/download-rate-limit', put({ perDay: 5, burstPerMinute: 10 }))).status, 400);
    assert.equal((await req('/api/download-rate-limit', put({ perDay: 0, burstPerMinute: 1 }))).status, 400);

    const res = (await (await req('/api/download-rate-limit', put({ perDay: 250, burstPerMinute: 20 }))).json()) as any;
    assert.equal(res.changed, true);
    assert.equal(res.result.perDay, 250);
    assert.equal(res.result.burstPerMinute, 20);
    assert.deepEqual(calls.at(-1)!.body, { perDay: 250, burstPerMinute: 20, actorId: 'admin-1' });
    assert.equal(calls.at(-1)!.key, 'k');

    const rows = await audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, DOWNLOAD_RATE_LIMIT_AUDIT_KEY);
    assert.equal(rows[0].old_value, JSON.stringify({ perDay: 100, burstPerMinute: 10 }));
    assert.equal(rows[0].new_value, JSON.stringify({ perDay: 250, burstPerMinute: 20 }));

    const again = (await (await req('/api/download-rate-limit', put({ perDay: 250, burstPerMinute: 20 }))).json()) as any;
    assert.equal(again.changed, false);
    assert.equal((await audit()).length, 1);

    const history = (await (await req('/api/download-rate-limit/history')).json()) as any;
    assert.equal(history.result.entries.length, 1);
    assert.equal(history.result.entries[0].newValue, JSON.stringify({ perDay: 250, burstPerMinute: 20 }));
  });

  it('drops the audit row on 4xx rejection and keeps it marked failed on 5xx errors', async () => {
    const rejected = setup(['super_admin'], 400);
    assert.equal((await rejected.req('/api/download-rate-limit', put({ perDay: 300, burstPerMinute: 25 }))).status, 400);
    assert.deepEqual(await rejected.audit(), []);

    const upstreamErr = setup(['super_admin'], 500);
    assert.equal((await upstreamErr.req('/api/download-rate-limit', put({ perDay: 300, burstPerMinute: 25 }))).status, 500);
    const rows = await upstreamErr.audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].new_value, JSON.stringify({ perDay: 300, burstPerMinute: 25, failed: true }));
  });
});
