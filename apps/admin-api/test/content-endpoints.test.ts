/**
 * The content management endpoints through the real router: which role may
 * do what, the audit row each change writes (and drops when api-videos
 * refuses), the report counts added to lists, and the call made to api-videos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import contentRouter from '../src/routers/content.router';

interface LogRow { id: string; key: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }
interface ReportRow { id: string; entity_type: string; entity_id: string; reporter_id: string; reason: string; description: string | null; status: string; action: string | null; created_at: string }

/** Just enough D1 for site_settings_log and reports. */
function fakeDb(reports: ReportRow[] = []) {
  const log: LogRow[] = [];
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    async run() {
      if (sql.startsWith('INSERT INTO site_settings_log')) {
        const [id, key, old_value, new_value, actor_id, created_at] = args as string[];
        log.push({ id, key, old_value, new_value, actor_id, created_at });
      } else if (sql.startsWith('DELETE FROM site_settings_log')) {
        const index = log.findIndex((r) => r.id === args[0]);
        if (index >= 0) log.splice(index, 1);
      }
    },
    async all() {
      if (sql.includes('FROM site_settings_log')) {
        const rows = sql.includes('key = ?')
          ? log.filter((r) => r.key === args[0])
          : log.filter((r) => r.key >= (args[0] as string) && r.key < (args[1] as string));
        return { results: [...rows].reverse().slice(0, args[args.length - 1] as number) };
      }
      if (sql.includes('COUNT(*)')) {
        const [type, ...ids] = args as string[];
        const counts = new Map<string, number>();
        for (const r of reports) {
          if (r.entity_type === type && ids.includes(r.entity_id) && ['pending', 'reviewing'].includes(r.status)) counts.set(r.entity_id, (counts.get(r.entity_id) ?? 0) + 1);
        }
        return { results: [...counts].map(([entity_id, n]) => ({ entity_id, n })) };
      }
      if (sql.includes('MAX(created_at)')) {
        const [type] = args as string[];
        return { results: [...new Set(reports.filter((r) => r.entity_type === type && ['pending', 'reviewing'].includes(r.status)).map((r) => r.entity_id))].map((entity_id) => ({ entity_id })) };
      }
      const [type, ...rest] = args as string[];
      const ids = rest.slice(0, -1);
      return { results: reports.filter((r) => r.entity_type === type && ids.includes(r.entity_id)) };
    },
  });
  return { db: { prepare: (sql: string) => statement(sql) } as unknown as D1Database, log };
}

interface VideosCallRecord { method: string; path: string; search: string; actor: string | null; key: string | null; body: unknown }

/** api-videos behind the service binding: records calls, answers from `routes`. */
function fakeVideos(routes: Record<string, (call: VideosCallRecord) => { status?: number; body: unknown }> = {}) {
  const calls: VideosCallRecord[] = [];
  const fetcher = {
    async fetch(input: string, init: RequestInit = {}) {
      const url = new URL(input);
      const headers = new Headers(init.headers);
      const call: VideosCallRecord = {
        method: init.method ?? 'GET',
        path: url.pathname.replace('/internal/admin', ''),
        search: url.search,
        actor: headers.get('X-Admin-Actor'),
        key: headers.get('X-API-Key'),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body ?? null,
      };
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
    // Mirrors authMiddleware + adminMiddleware: the verified user and normalized roles
    const roles = c.req.header('x-test-roles') ?? '';
    c.set('auth' as never, { userId: c.req.header('x-test-user') ?? 'admin-1', roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  app.route('/api/content', contentRouter);
  return (path: string, init: RequestInit & { roles: string; user?: string; json?: unknown } ) => {
    const { roles, user = 'admin-1', json, ...rest } = init;
    const headers: Record<string, string> = { 'x-test-roles': roles, 'x-test-user': user };
    if (json !== undefined) headers['content-type'] = 'application/json';
    return app.request(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body }, { INTERNAL_API_KEY: 'internal-key', ...env });
  };
}

const channelDetail = { id: 'ch_1', name: 'Old name', handle: 'old', description: 'd', ownerId: 'usr_owner', channels: [] };

describe('content endpoints: permissions', () => {
  const changes: [string, string, unknown?][] = [
    ['PATCH', '/api/content/channels/ch_1', { name: 'New' }],
    ['POST', '/api/content/channels/ch_1/suspend', { reason: 'spam' }],
    ['POST', '/api/content/channels/ch_1/unsuspend'],
    ['POST', '/api/content/channels/ch_1/transfer', { newOwnerId: 'usr_2' }],
    ['DELETE', '/api/content/channels/ch_1'],
    ['PATCH', '/api/content/videos/v_1', { title: 'T' }],
    ['POST', '/api/content/videos/v_1/move', { channelId: 'ch_2' }],
    ['POST', '/api/content/videos/v_1/unpublish'],
    ['POST', '/api/content/videos/v_1/republish'],
    ['POST', '/api/content/videos/v_1/reprocess'],
    ['DELETE', '/api/content/videos/v_1'],
    ['DELETE', '/api/content/videos/v_1/comments/c_1'],
    ['DELETE', '/api/content/playlists/p_1'],
    ['DELETE', '/api/content/posts/ch_1/post_1'],
    ['PATCH', '/api/content/users/usr_1', { displayName: 'X' }],
    ['POST', '/api/content/users/usr_1/ban', { reason: 'abuse' }],
    ['POST', '/api/content/users/usr_1/unban'],
    ['POST', '/api/content/users/usr_1/delete-data'],
  ];

  it('a moderator can read every list and detail but change nothing, and leaves no audit row', async () => {
    const { db, log } = fakeDb();
    const { fetcher, calls } = fakeVideos({
      'GET /channels/ch_1': () => ({ body: { success: true, result: channelDetail } }),
      'GET /channels': () => ({ body: { success: true, result: { items: [], total: 0, page: 1, pageSize: 20, indexComplete: true } } }),
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    for (const path of ['/api/content/channels', '/api/content/channels/ch_1', '/api/content/comments', '/api/content/playlists', '/api/content/posts', '/api/content/users']) {
      assert.equal((await call(path, { roles: 'moderator' })).status, 200, path);
    }
    const reads = calls.length;
    for (const [method, path, json] of changes) {
      const res = await call(path, { method, roles: 'moderator', json });
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(((await res.json()) as { code: string }).code, 'forbidden');
    }
    assert.equal(calls.length, reads, 'no change reached api-videos');
    assert.equal(log.length, 0);
  });

  it('an admin can make every change except a channel transfer', async () => {
    const { db } = fakeDb();
    const { fetcher } = fakeVideos({
      'GET /channels/ch_1': () => ({ body: { success: true, result: channelDetail } }),
      'GET /videos/v_1': () => ({ body: { success: true, result: { id: 'v_1', title: 'Old', channelId: 'ch_1', ownerId: 'usr_owner' } } }),
      'GET /users/usr_1': () => ({ body: { success: true, result: { id: 'usr_1', displayName: 'Old', channels: [] } } }),
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    for (const [method, path, json] of changes) {
      const res = await call(path, { method, roles: 'admin', json });
      const expected = path.endsWith('/transfer') ? 403 : 200;
      assert.equal(res.status, expected, `${method} ${path}`);
    }
  });

  it('only a super admin transfers a channel', async () => {
    const { db, log } = fakeDb();
    const { fetcher, calls } = fakeVideos({ 'GET /channels/ch_1': () => ({ body: { success: true, result: channelDetail } }) });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const res = await call('/api/content/channels/ch_1/transfer', { method: 'POST', roles: 'super_admin', user: 'super-1', json: { newOwnerId: 'usr_2' } });
    assert.equal(res.status, 200);
    const transfer = calls.find((c) => c.path === '/channels/ch_1/transfer')!;
    assert.deepEqual(transfer.body, { newOwnerId: 'usr_2' });
    assert.equal(transfer.actor, 'super-1');
    assert.equal(transfer.key, 'internal-key');
    assert.equal(log.length, 1);
    assert.deepEqual(JSON.parse(log[0].new_value), { action: 'transfer', details: { newOwnerId: 'usr_2' } });
    assert.deepEqual(JSON.parse(log[0].old_value!), { ownerId: 'usr_owner' });
  });

  it('the permissions endpoint lists what the caller may do', async () => {
    const call = appFor({ REPORTS_DB: fakeDb().db, VIDEOS: fakeVideos().fetcher });
    const read = async (roles: string) => ((await (await call('/api/content/permissions', { roles })).json()) as { result: { permissions: string[] } }).result.permissions;
    assert.deepEqual(await read('moderator'), []);
    assert.ok(!(await read('admin')).includes('channels:transfer'));
    assert.ok((await read('super_admin')).includes('channels:transfer'));
  });
});

describe('content endpoints: audit log', () => {
  it('an edit records the action, the new values and the previous ones, and the item history reads it back', async () => {
    const { db, log } = fakeDb();
    const { fetcher } = fakeVideos({ 'GET /channels/ch_1': () => ({ body: { success: true, result: channelDetail } }) });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const res = await call('/api/content/channels/ch_1', { method: 'PATCH', roles: 'admin', user: 'actor-9', json: { name: 'New name' } });
    assert.equal(res.status, 200);
    assert.equal(log.length, 1);
    assert.equal(log[0].key, 'content:channel:ch_1');
    assert.equal(log[0].actor_id, 'actor-9');
    assert.deepEqual(JSON.parse(log[0].new_value), { action: 'edit', details: { name: 'New name' } });
    assert.deepEqual(JSON.parse(log[0].old_value!), { name: 'Old name' });

    const detail = (await (await call('/api/content/channels/ch_1', { roles: 'moderator' })).json()) as { result: { audit: { action: string; actorId: string }[] } };
    assert.deepEqual(detail.result.audit.map((a) => [a.action, a.actorId]), [['edit', 'actor-9']]);

    const feed = (await (await call('/api/content/audit', { roles: 'moderator' })).json()) as { result: { entries: { key: string }[] } };
    assert.deepEqual(feed.result.entries.map((e) => e.key), ['content:channel:ch_1']);
  });

  it('a change api-videos refuses leaves no audit row and passes its error on', async () => {
    const { db, log } = fakeDb();
    const { fetcher } = fakeVideos({
      'POST /users/usr_1/ban': () => ({ status: 404, body: { success: false, code: 'not_found', error: 'No such user' } }),
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const res = await call('/api/content/users/usr_1/ban', { method: 'POST', roles: 'admin', json: { reason: 'x' } });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { code: string }).code, 'not_found');
    assert.equal(log.length, 0);
  });

  it('a resumed user data delete is audited too', async () => {
    const { db, log } = fakeDb();
    const { fetcher, calls } = fakeVideos();
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    await call('/api/content/users/usr_1/delete-data', { method: 'POST', roles: 'super_admin', json: {} });
    await call('/api/content/users/usr_1/delete-data', { method: 'POST', roles: 'super_admin', json: { resumeToken: 'tok' } });
    assert.deepEqual(log.map((r) => JSON.parse(r.new_value).action), ['delete-data', 'delete-data:resume']);
    assert.deepEqual(calls.map((c) => c.body), [{}, { resumeToken: 'tok' }]);
  });
});

describe('content endpoints: reports', () => {
  const report = (id: string, type: string, entity: string, status = 'pending'): ReportRow => ({
    id, entity_type: type, entity_id: entity, reporter_id: 'usr_r', reason: 'spam', description: null, status, action: null, created_at: `2026-11-0${id.length}T00:00:00Z`,
  });

  it('lists carry open report counts, and "reported" narrows the list to reported ids', async () => {
    const { db } = fakeDb([report('r1', 'video', 'v_1'), report('r22', 'video', 'v_1'), report('r333', 'video', 'v_2', 'resolved')]);
    const { fetcher, calls } = fakeVideos({
      'GET /videos': () => ({ body: { success: true, result: { items: [{ id: 'v_1' }, { id: 'v_2' }], total: 2, page: 1, pageSize: 20, indexComplete: true } } }),
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const list = (await (await call('/api/content/videos?q=talk', { roles: 'moderator' })).json()) as { result: { items: { id: string; openReports: number }[] } };
    assert.deepEqual(list.result.items.map((i) => [i.id, i.openReports]), [['v_1', 2], ['v_2', 0]]);
    assert.equal(calls[0].search, '?q=talk');

    await call('/api/content/videos?reported=yes&sort=views', { roles: 'moderator' });
    const params = new URLSearchParams(calls[1].search);
    assert.equal(params.get('ids'), 'v_1');
    assert.equal(params.get('sort'), 'views');
    assert.equal(params.get('reported'), null);
  });

  it('with nothing reported, the "reported" list is empty without asking api-videos', async () => {
    const { fetcher, calls } = fakeVideos();
    const call = appFor({ REPORTS_DB: fakeDb().db, VIDEOS: fetcher });
    const res = (await (await call('/api/content/channels?reported=yes', { roles: 'admin' })).json()) as { result: { items: unknown[]; total: number } };
    assert.deepEqual([res.result.items.length, res.result.total], [0, 0]);
    assert.equal(calls.length, 0);
  });

  it('a detail page carries the recent reports against it', async () => {
    const { db } = fakeDb([report('r1', 'channel', 'ch_1'), report('r22', 'channel', 'ch_other')]);
    const { fetcher } = fakeVideos({ 'GET /channels/ch_1': () => ({ body: { success: true, result: channelDetail } }) });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const detail = (await (await call('/api/content/channels/ch_1', { roles: 'moderator' })).json()) as { result: { openReports: number; reports: { id: string }[] } };
    assert.equal(detail.result.openReports, 1);
    assert.deepEqual(detail.result.reports.map((r) => r.id), ['r1']);
  });
});
