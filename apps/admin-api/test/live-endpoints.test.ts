/**
 * Live streaming provider endpoints (/api/content/live/*) through the real
 * router: reads for every admin role, changes only with live:manage (admins
 * and super admins, never moderators), one audit row per change with the
 * values it replaced, no row when api-videos refuses, and the exact call made
 * to api-videos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { DEFAULT_LIVE_ROUTING, hasContentPermission } from '@al-ummah/shared-types';
import contentRouter from '../src/routers/content.router';

interface LogRow { id: string; key: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }

function fakeDb() {
  const log: LogRow[] = [];
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    async run() {
      if (sql.startsWith('INSERT INTO site_settings_log')) {
        const [id, key, old_value, new_value, actor_id, created_at] = args as string[];
        log.push({ id, key, old_value, new_value, actor_id, created_at });
      } else if (sql.startsWith('UPDATE site_settings_log')) {
        const row = log.find((r) => r.id === args[1]);
        if (row) row.old_value = args[0] as string;
      } else if (sql.startsWith('DELETE FROM site_settings_log')) {
        const index = log.findIndex((r) => r.id === args[0]);
        if (index >= 0) log.splice(index, 1);
      }
    },
    async all() {
      const rows = sql.includes('key = ?') ? log.filter((r) => r.key === args[0]) : log.filter((r) => r.key >= (args[0] as string) && r.key < (args[1] as string));
      return { results: [...rows].reverse().slice(0, args[args.length - 1] as number) };
    },
  });
  return { db: { prepare: (sql: string) => statement(sql) } as unknown as D1Database, log };
}

interface Call { method: string; path: string; search: string; body: unknown }

function fakeVideos(routes: Record<string, (call: Call) => { status?: number; body: unknown }> = {}) {
  const calls: Call[] = [];
  const fetcher = {
    async fetch(input: string, init: RequestInit = {}) {
      const url = new URL(input);
      const call: Call = { method: init.method ?? 'GET', path: url.pathname.replace('/internal/admin', ''), search: url.search, body: typeof init.body === 'string' ? JSON.parse(init.body) : null };
      calls.push(call);
      const handler = routes[`${call.method} ${call.path}`];
      const answer = handler ? handler(call) : { body: { success: true, result: { ok: true } } };
      return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'content-type': 'application/json' } });
    },
  };
  return { fetcher, calls };
}

function appFor(env: Record<string, unknown>) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-test-roles') ?? '';
    c.set('auth' as never, { userId: 'admin-1', roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  app.route('/api/content', contentRouter);
  return (path: string, init: RequestInit & { roles: string; json?: unknown }) => {
    const { roles, json, ...rest } = init;
    const headers: Record<string, string> = { 'x-test-roles': roles };
    if (json !== undefined) headers['content-type'] = 'application/json';
    return app.request(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body }, { INTERNAL_API_KEY: 'internal-key', ...env });
  };
}

const usage = { bunny: { active: 0, monthSpendUsd: 0, available: false }, selfhosted: { active: 1, monthSpendUsd: 2.5, available: true } };
const settingsView = (overrides: unknown[] = []) => ({ success: true, result: { settings: DEFAULT_LIVE_ROUTING, usage, overrides } });

describe('live streaming endpoints', () => {
  it('grants live:manage to super admins and admins, never moderators', () => {
    assert.equal(hasContentPermission(['super_admin'], 'live:manage'), true);
    assert.equal(hasContentPermission(['admin'], 'live:manage'), true);
    assert.equal(hasContentPermission(['moderator'], 'live:manage'), false);
  });

  it('every admin role reads; a moderator changes nothing and leaves no audit row', async () => {
    const { db, log } = fakeDb();
    const { fetcher, calls } = fakeVideos({ 'GET /live/settings': () => ({ body: settingsView() }) });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    for (const path of ['/api/content/live/settings', '/api/content/live/sessions?status=active', '/api/content/live/compare?tests=1', '/api/content/live/audit']) {
      assert.equal((await call(path, { roles: 'moderator' })).status, 200, path);
    }
    const reads = calls.length;
    const changes: [string, string, unknown][] = [
      ['PUT', '/api/content/live/settings', { mode: 'only_bunny' }],
      ['PUT', '/api/content/live/overrides/ch_1', { provider: 'bunny' }],
      ['DELETE', '/api/content/live/overrides/ch_1', {}],
      ['POST', '/api/content/live/streams/ls_1/move', { provider: 'selfhosted' }],
      ['POST', '/api/content/live/sessions/sess_1/end', {}],
    ];
    for (const [method, path, json] of changes) {
      const res = await call(path, { method, roles: 'moderator', json });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
    assert.equal(calls.length, reads, 'no change reached api-videos');
    assert.equal(log.length, 0);
  });

  it('a settings change sends only known fields and audits the values it replaces', async () => {
    const { db, log } = fakeDb();
    const { fetcher, calls } = fakeVideos({
      'GET /live/settings': () => ({ body: settingsView() }),
      'PUT /live/settings': (c) => ({ body: { success: true, result: { previous: DEFAULT_LIVE_ROUTING, current: { ...DEFAULT_LIVE_ROUTING, ...(c.body as object) } } } }),
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const res = await call('/api/content/live/settings', {
      method: 'PUT',
      roles: 'admin',
      json: { mode: 'weighted', bunnyPercent: 70, updatedBy: 'spoof', providers: { bunny: { draining: true, junk: 1 } } },
    });
    assert.equal(res.status, 200);
    const put = calls.find((c) => c.method === 'PUT');
    assert.deepEqual(put?.body, { mode: 'weighted', bunnyPercent: 70, providers: { bunny: { draining: true } } });
    assert.equal(log.length, 1);
    assert.equal(log[0].key, 'content:live-settings:routing');
    assert.deepEqual(JSON.parse(log[0].old_value!), { mode: 'round_robin', bunnyPercent: 50, providers: { bunny: { draining: false } } });
    assert.equal(JSON.parse(log[0].new_value).action, 'edit');

    const empty = await call('/api/content/live/settings', { method: 'PUT', roles: 'admin', json: { updatedAt: 'x' } });
    assert.equal(empty.status, 400);
  });

  it('drops the audit row when api-videos refuses', async () => {
    const { db, log } = fakeDb();
    const { fetcher } = fakeVideos({
      'GET /live/settings': () => ({ body: settingsView() }),
      'PUT /live/settings': () => ({ status: 400, body: { success: false, code: 'invalid_request', error: 'bad' } }),
    });
    const res = await appFor({ REPORTS_DB: db, VIDEOS: fetcher })('/api/content/live/settings', { method: 'PUT', roles: 'super_admin', json: { fallback: false } });
    assert.equal(res.status, 400);
    assert.equal(log.length, 0);
  });

  it('overrides record the previous provider; set and remove reach api-videos', async () => {
    const { db, log } = fakeDb();
    const existing = { channelId: 'ch_1', provider: 'selfhosted', note: 'test', updatedBy: 'a', updatedAt: '2026-11-11T00:00:00Z' };
    const { fetcher, calls } = fakeVideos({ 'GET /live/settings': () => ({ body: settingsView([existing]) }) });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    assert.equal((await call('/api/content/live/overrides/ch_1', { method: 'PUT', roles: 'admin', json: { provider: 'bunny', note: '  try bunny ' } })).status, 200);
    assert.deepEqual(calls.find((c) => c.method === 'PUT')?.body, { provider: 'bunny', note: 'try bunny' });
    assert.deepEqual(JSON.parse(log[0].old_value!), { provider: 'selfhosted', note: 'test' });
    assert.equal(log[0].key, 'content:live-override:ch_1');

    assert.equal((await call('/api/content/live/overrides/ch_1', { method: 'PUT', roles: 'admin', json: { provider: 'other' } })).status, 400);
    assert.equal((await call('/api/content/live/overrides/ch_1', { method: 'DELETE', roles: 'admin' })).status, 200);
    assert.equal(log[1].key, 'content:live-override:ch_1');
    assert.equal(JSON.parse(log[1].new_value).action, 'remove');
  });

  it('a stream move records the move it replaced once api-videos answers', async () => {
    const { db, log } = fakeDb();
    const { fetcher, calls } = fakeVideos({ 'POST /live/streams/ls_1/move': () => ({ body: { success: true, result: { id: 'ls_1', providerMove: 'bunny', previous: 'selfhosted', currentProvider: 'selfhosted' } } }) });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const res = await call('/api/content/live/streams/ls_1/move', { method: 'POST', roles: 'admin', json: { provider: 'bunny' } });
    assert.equal(res.status, 200);
    assert.deepEqual(calls[0].body, { provider: 'bunny' });
    assert.deepEqual(JSON.parse(log[0].old_value!), { provider: 'selfhosted' });
    assert.equal((await call('/api/content/live/streams/ls_1/move', { method: 'POST', roles: 'admin', json: { provider: null } })).status, 200);
    assert.equal((await call('/api/content/live/streams/ls_1/move', { method: 'POST', roles: 'admin', json: { provider: 'x' } })).status, 400);
  });

  it('ending a session is audited; the history lists only live changes, newest first', async () => {
    const { db, log } = fakeDb();
    const { fetcher } = fakeVideos({ 'GET /live/settings': () => ({ body: settingsView() }) });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    log.push({ id: 'other', key: 'content:video:v_1', old_value: null, new_value: '{"action":"edit"}', actor_id: 'a', created_at: '2026-11-11T00:00:00Z' });
    assert.equal((await call('/api/content/live/sessions/sess_1/end', { method: 'POST', roles: 'super_admin' })).status, 200);
    assert.equal((await call('/api/content/live/settings', { method: 'PUT', roles: 'admin', json: { fallback: false } })).status, 200);
    const res = await call('/api/content/live/audit', { roles: 'moderator' });
    const items = ((await res.json()) as { result: { items: { key: string; action: string }[] } }).result.items;
    assert.deepEqual(items.map((i) => i.key), ['content:live-settings:routing', 'content:live-session:sess_1']);
  });

  it('passes only known query parameters to sessions and compare', async () => {
    const { db } = fakeDb();
    const { fetcher, calls } = fakeVideos();
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    await call('/api/content/live/sessions?status=active&provider=bunny&limit=20&x=1', { roles: 'moderator' });
    await call('/api/content/live/compare?from=2026-11-01&to=bad&tests=1', { roles: 'moderator' });
    assert.equal(new URLSearchParams(calls[0].search).toString(), 'status=active&provider=bunny&limit=20');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[1].search)), { tests: '1', from: '2026-11-01' });
  });
});
