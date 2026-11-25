/**
 * /api/app-config (issue #413): remote config and feature flags edited from the videos admin.
 * settings:manage only; every change audited first (old and new document) and the row dropped
 * when api-videos refuses it; a stale editor gets 409 instead of overwriting; dry runs proxy.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import router, { appConfigAuditKey, sameDocument } from '../src/routers/appConfig.router';
import { sqliteD1 } from './d1-sqlite';

function setup(roles: string[], opts: { reject?: boolean; down?: boolean } = {}) {
  const store: Record<string, unknown> = { flags: [{ key: 'downloads', enabled: true }] };
  const calls: { method: string; path: string; body: any; key: string | null }[] = [];
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const method = init?.method ?? 'GET';
        const path = new URL(input).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ method, path, body, key: new Headers(init?.headers).get('X-API-Key') });
        const key = path.split('/').pop()!;
        if (opts.down) return new Response(JSON.stringify({ success: false, error: 'boom' }), { status: 500 });
        if (path.endsWith('/lookup')) return Response.json({ success: true, result: { items: [], users: body.users.map((id: string) => ({ id, found: true, displayName: 'Aisha Rahman', userName: 'aisha', isBanned: false })) } });
        if (path.endsWith('/evaluate')) return Response.json({ success: true, result: { flags: { downloads: true }, config: {}, update: { status: 'ok' } } });
        if (method === 'PUT') {
          if (opts.reject) return Response.json({ success: false, error: 'invalid_document', problems: [{ path: [0, 'key'], message: 'Invalid' }] }, { status: 400 });
          store[key] = body;
        }
        return Response.json({ success: true, result: store[key] ?? null });
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles } as never);
    await next();
  });
  app.route('/api/app-config', router);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const audit = async () => ((await env.REPORTS_DB.prepare('SELECT key, old_value, new_value, actor_id FROM site_settings_log').all<any>()).results ?? []).map((r: any) => ({ ...r }));
  return { req, calls, audit, store };
}

const send = (method: string, json: unknown): RequestInit => ({ method, body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });

describe('/api/app-config', () => {
  it('is for settings:manage only (moderators get nothing, not even a read)', async () => {
    const { req, calls } = setup(['moderator']);
    assert.equal((await req('/api/app-config/flags')).status, 403);
    assert.equal((await req('/api/app-config/flags', send('PUT', { value: [] }))).status, 403);
    assert.equal((await req('/api/app-config/evaluate', send('POST', { context: {} }))).status, 403);
    assert.equal(calls.length, 0);
  });

  it('reads a document through the internal key, which never leaves the server', async () => {
    const { req, calls } = setup(['admin']);
    const body: any = await (await req('/api/app-config/flags')).json();
    assert.deepEqual(body.result, { key: 'flags', value: [{ key: 'downloads', enabled: true }] });
    assert.equal(calls[0].key, 'k');
    assert.equal(JSON.stringify(body).includes('"k"'), false);
    assert.equal((await req('/api/app-config/secrets')).status, 404);
  });

  it('saves with an audit row holding the old and new document and the actor', async () => {
    const { req, audit, store } = setup(['super_admin']);
    const value = [{ key: 'downloads', enabled: false }];
    const res = await req('/api/app-config/flags', send('PUT', { value, expected: [{ enabled: true, key: 'downloads' }] }));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).changed, true);
    assert.deepEqual(store.flags, value);
    assert.deepEqual(await audit(), [{ key: appConfigAuditKey('flags'), old_value: JSON.stringify([{ key: 'downloads', enabled: true }]), new_value: JSON.stringify(value), actor_id: 'admin-1' }]);
    const history: any = await (await req('/api/app-config/flags/history')).json();
    assert.deepEqual([history.result.entries[0].actorId, history.result.entries[0].actorName], ['admin-1', 'Aisha Rahman'], 'who changed it, by name');
  });

  it('an unchanged document writes nothing', async () => {
    const { req, calls, audit } = setup(['admin']);
    const res: any = await (await req('/api/app-config/flags', send('PUT', { value: [{ enabled: true, key: 'downloads' }] }))).json();
    assert.equal(res.changed, false);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
    assert.deepEqual(await audit(), []);
  });

  it('refuses to overwrite a document that changed since the editor opened it', async () => {
    const { req, calls, audit } = setup(['admin']);
    const res = await req('/api/app-config/flags', send('PUT', { value: [], expected: [] }));
    assert.equal(res.status, 409);
    assert.deepEqual(((await res.json()) as any).result.value, [{ key: 'downloads', enabled: true }], 'the current document comes back');
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
    assert.deepEqual(await audit(), []);
  });

  it('a document api-videos refuses comes back with its problems, and no audit row stays', async () => {
    const { req, audit } = setup(['admin'], { reject: true });
    const res = await req('/api/app-config/flags', send('PUT', { value: [{ key: 'BAD' }] }));
    assert.equal(res.status, 400);
    const body: any = await res.json();
    assert.equal(body.code, 'invalid_document');
    assert.deepEqual(body.problems[0], { problem: '0.key', detail: 'Invalid' }, 'where and what, in the admin problem shape');
    assert.deepEqual(await audit(), []);
  });

  it('api-videos down: 502, no audit row', async () => {
    const { req, audit } = setup(['admin'], { down: true });
    assert.equal((await req('/api/app-config/flags')).status, 502);
    assert.deepEqual(await audit(), []);
  });

  it('dry runs go to api-videos with the drafts', async () => {
    const { req, calls } = setup(['admin']);
    const context = { platform: 'ios', app: 'viewer', version: '1.0.0' };
    const res: any = await (await req('/api/app-config/evaluate', send('POST', { context, documents: { flags: [] } }))).json();
    assert.deepEqual(res.result.flags, { downloads: true });
    assert.deepEqual(calls[0].body, { context, documents: { flags: [] } });
    assert.equal((await req('/api/app-config/evaluate', send('POST', {}))).status, 400);
  });

  it('compares documents ignoring key order', () => {
    assert.equal(sameDocument({ a: 1, b: [{ x: 1, y: 2 }] }, { b: [{ y: 2, x: 1 }], a: 1 }), true);
    assert.equal(sameDocument([1, 2], [2, 1]), false, 'rule order matters');
    assert.equal(sameDocument(null, undefined), true);
  });
});

describe('app versions and releases (wiki AUN-APP-UPDATES §4.2, #1434)', () => {
  it('only super admins change the versions document; admins still read it', async () => {
    const admin = setup(['admin']);
    assert.equal((await admin.req('/api/app-config/versions', send('PUT', { value: { 'viewer/ios': { minimumVersion: '0.0.0' } } }))).status, 403);
    assert.equal((await admin.req('/api/app-config/versions')).status, 200);
    assert.deepEqual(await admin.audit(), [], 'nothing audited for a refused change');
    const owner = setup(['super_admin']);
    assert.equal((await owner.req('/api/app-config/versions', send('PUT', { value: { 'viewer/ios': { minimumVersion: '0.0.0' } } }))).status, 200);
  });

  it('admins read and refresh the release index through the internal key', async () => {
    const { req, calls } = setup(['admin']);
    assert.equal((await req('/api/app-config/releases')).status, 200);
    assert.equal((await req('/api/app-config/releases/refresh', send('POST', {}))).status, 200);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /internal/app-config/releases', 'POST /internal/app-config/releases/refresh']);
  });

  it('marking a store upload available is super-admin only, validated and audited', async () => {
    const admin = setup(['admin']);
    assert.equal((await admin.req('/api/app-config/releases/available', send('PUT', { app: 'admin', platform: 'ios', source: 'testflight', version: '1.4.0' }))).status, 403);
    const owner = setup(['super_admin']);
    assert.equal((await owner.req('/api/app-config/releases/available', send('PUT', { app: 'admin', platform: 'ios', source: 'play', version: '1.4.0' }))).status, 400);
    const ok = await owner.req('/api/app-config/releases/available', send('PUT', { app: 'admin', platform: 'ios', source: 'testflight', version: '1.4.0' }));
    assert.equal(ok.status, 200);
    assert.equal(owner.calls.at(-1)?.path, '/internal/app-config/releases/available');
    const rows = await owner.audit();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, 'app-config:availability');
    assert.deepEqual(JSON.parse(rows[0].new_value), { app: 'admin', platform: 'ios', source: 'testflight', version: '1.4.0' });
    assert.equal(rows[0].old_value, null, 'no mark before');
    // The next change records the mark it replaces
    owner.store.releases = { availability: { 'admin/ios/testflight': '1.4.0' } };
    await owner.req('/api/app-config/releases/available', send('PUT', { app: 'admin', platform: 'ios', source: 'testflight', version: null }));
    const cleared = (await owner.audit()).find((r: any) => JSON.parse(r.new_value).version === null);
    assert.deepEqual(JSON.parse(cleared.old_value), { app: 'admin', platform: 'ios', source: 'testflight', version: '1.4.0' });
  });

  it('a refused mark drops its audit row', async () => {
    const owner = setup(['super_admin'], { down: true });
    await owner.req('/api/app-config/releases/available', send('PUT', { app: 'admin', platform: 'ios', source: 'testflight', version: '1.4.0' }));
    assert.deepEqual(await owner.audit(), []);
  });
});
