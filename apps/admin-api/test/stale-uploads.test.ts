/**
 * /api/uploads/stale/*: the videos admin's own permission (videos:uploads),
 * audit-first (dropped when api-videos fails), forwarding to api-videos'
 * /internal/uploads over the VIDEOS binding with the internal key.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import staleUploadsRouter, { REAPER_MODE_AUDIT_KEY, STALE_UPLOAD_AUDIT_PREFIX, TEST_LIBRARY_PURGE_AUDIT_KEY } from '../src/routers/staleUploads.router';
import { permissionsFor } from '../src/lib/roles';
import { sqliteD1 } from './d1-sqlite';

const ID = '912859ed-e618-4d04-8438-874a74a251dd';

function setup(roles: string[], answer: (path: string, body: any) => { status: number; json: unknown } = () => ({ status: 200, json: { success: true, result: { ok: true } } })) {
  const calls: { path: string; method: string; body: any; key: string | null }[] = [];
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const url = new URL(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ path: url.pathname + url.search, method: init?.method ?? 'GET', body, key: new Headers(init?.headers).get('X-API-Key') });
        const r = answer(url.pathname, body);
        return new Response(JSON.stringify(r.json), { status: r.status });
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', email: 'admin@example.com', roles } as never);
    await next();
  });
  app.route('/api/uploads/stale', staleUploadsRouter);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const audit = async () => (await env.REPORTS_DB.prepare('SELECT key, new_value, actor_id FROM site_settings_log').all<any>()).results ?? [];
  return { req, calls, audit };
}

const post = (json: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });

describe('/api/uploads/stale', () => {
  it('needs videos:uploads (admins and super admins; moderators are refused)', async () => {
    const { req, calls } = setup(['moderator']);
    assert.equal((await req('/api/uploads/stale')).status, 403);
    assert.equal((await req('/api/uploads/stale/delete', post({ ids: [ID] }))).status, 403);
    assert.equal(calls.length, 0);
    assert.ok(permissionsFor(['Admin']).includes('videos:uploads'));
    assert.ok(permissionsFor(['Super Admin']).includes('videos:uploads'));
    assert.ok(!permissionsFor(['Moderator']).includes('videos:uploads'));
  });

  it('lists through the VIDEOS binding with the internal key', async () => {
    const { req, calls } = setup(['Admin']);
    const res = await req('/api/uploads/stale?status=would_delete');
    assert.equal(res.status, 200);
    assert.equal(calls[0].path, '/internal/uploads/stale?status=would_delete');
    assert.equal(calls[0].key, 'k');
  });

  it('Delete now, Keep and Retry are audited per video and name the admin', async () => {
    const { req, calls, audit } = setup(['super_admin']);
    for (const action of ['delete', 'keep', 'retry']) {
      const res = await req(`/api/uploads/stale/${action}`, post({ ids: [ID] }));
      assert.equal(res.status, 200, action);
    }
    assert.deepEqual(calls.map((c) => c.path), ['/internal/uploads/delete', '/internal/uploads/keep', '/internal/uploads/retry']);
    assert.deepEqual(calls[0].body, { ids: [ID], actor: 'admin@example.com' });
    const rows = await audit();
    assert.deepEqual(rows.map((r: any) => JSON.parse(r.new_value).action), ['delete_now', 'keep', 'retry']);
    assert.ok(rows.every((r: any) => r.key === `${STALE_UPLOAD_AUDIT_PREFIX}${ID}` && r.actor_id === 'admin-1'));
  });

  it('the reaper mode switch is audited and validated', async () => {
    const { req, calls, audit } = setup(['admin']);
    assert.equal((await req('/api/uploads/stale/mode', post({ mode: 'on' }))).status, 400);
    assert.equal((await req('/api/uploads/stale/mode', post({ mode: 'live' }))).status, 200);
    assert.deepEqual(calls[0].body, { mode: 'live', actor: 'admin@example.com' });
    const rows = await audit();
    assert.equal(rows[0].key, REAPER_MODE_AUDIT_KEY);
    assert.deepEqual(JSON.parse(rows[0].new_value), { action: 'set_mode', details: { mode: 'live' } });
  });

  it('a failed action leaves no audit row and passes the error on', async () => {
    const { req, audit } = setup(['admin'], () => ({ status: 503, json: { success: false, error: 'busy' } }));
    const res = await req('/api/uploads/stale/delete', post({ ids: [ID] }));
    assert.equal(res.status, 503);
    assert.equal((await audit()).length, 0);
  });

  it('bad ids are refused before anything is called', async () => {
    const { req, calls } = setup(['admin']);
    assert.equal((await req('/api/uploads/stale/delete', post({ ids: ['../etc'] }))).status, 400);
    assert.equal((await req('/api/uploads/stale/keep', post({ ids: [] }))).status, 400);
    assert.equal(calls.length, 0);
  });

  it('the audit list shows recent actions', async () => {
    const { req } = setup(['admin']);
    await req('/api/uploads/stale/keep', post({ ids: [ID] }));
    const res = (await (await req('/api/uploads/stale/audit')).json()) as any;
    assert.equal(res.result.entries[0].videoId, ID);
    assert.equal(res.result.entries[0].action, 'keep');
  });

  it('test-library purge: dry run by default, audited, forwarded; bad actions refused', async () => {
    const { req, calls, audit } = setup(['Admin']);
    assert.equal((await req('/api/uploads/stale/test-library-purge', post({ action: 'wipe' }))).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await req('/api/uploads/stale/test-library-purge', post({ action: 'start' }))).status, 200);
    assert.equal(calls[0].path, '/internal/uploads/test-library-purge');
    assert.deepEqual(calls[0].body, { action: 'start', dryRun: true, resume: false, actor: 'admin@example.com' });
    assert.equal((await req('/api/uploads/stale/test-library-purge', post({ action: 'start', dryRun: false, resume: true }))).status, 200);
    assert.deepEqual(calls[1].body, { action: 'start', dryRun: false, resume: true, actor: 'admin@example.com' });
    // Wipe tuning is forwarded (numbers only; api-videos clamps it)
    assert.equal((await req('/api/uploads/stale/test-library-purge', post({ action: 'start', dryRun: false, minAgeMinutes: 10, concurrency: 40, pageSize: 100, statuses: [0, 1, 2, 3, 7], extra: 1, concurrencyX: 'no' }))).status, 200);
    assert.deepEqual(calls[2].body, { action: 'start', dryRun: false, resume: false, minAgeMinutes: 10, concurrency: 40, pageSize: 100, statuses: [0, 1, 2, 3, 7], actor: 'admin@example.com' });
    const rows = await audit();
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r: any) => r.key === TEST_LIBRARY_PURGE_AUDIT_KEY));
    assert.equal((await req('/api/uploads/stale/test-library-purge')).status, 200);
    assert.equal(calls[3].method, 'GET');
  });

  it('test-library purge: a refusal from api-videos (production) drops the audit row', async () => {
    const { req, audit } = setup(['Admin'], () => ({ status: 403, json: { success: false, error: 'The test-library purge runs only on QA / stage' } }));
    const res = await req('/api/uploads/stale/test-library-purge', post({ action: 'start', dryRun: false }));
    assert.equal(res.status, 403);
    assert.equal((await audit()).length, 0);
  });
});
