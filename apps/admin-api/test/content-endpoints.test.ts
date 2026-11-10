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

  it('a transfer without a user id is refused before anything is audited', async () => {
    const { db, log } = fakeDb();
    const { fetcher, calls } = fakeVideos();
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const res = await call('/api/content/channels/ch_1/transfer', { method: 'POST', roles: 'super_admin', json: { newOwnerId: '  ' } });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, 'invalid_new_owner');
    assert.equal(calls.length, 0);
    assert.equal(log.length, 0);
  });

  it('the transfer user search is for super admins and passes the query through', async () => {
    const { fetcher, calls } = fakeVideos({ 'GET /users/search': () => ({ body: { success: true, result: { items: [{ id: 'usr_2' }] } } }) });
    const call = appFor({ REPORTS_DB: fakeDb().db, VIDEOS: fetcher });
    assert.equal((await call('/api/content/users/search?q=amina', { roles: 'admin' })).status, 403);
    assert.equal((await call('/api/content/users/search?q=amina', { roles: 'moderator' })).status, 403);
    assert.equal(calls.length, 0);
    const res = await call('/api/content/users/search?q=%40amina&exclude=usr_owner&channelId=ch_1&other=x', { roles: 'super_admin' });
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { result: { items: unknown[] } }).result.items, [{ id: 'usr_2' }]);
    const params = new URLSearchParams(calls[0].search);
    assert.deepEqual(Object.fromEntries(params), { q: '@amina', exclude: 'usr_owner', channelId: 'ch_1' });
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

  it('a user data delete queues one job and is audited once', async () => {
    const { db, log } = fakeDb();
    const job = { id: 'job_1', kind: 'user.delete-data', targetKind: 'user', targetId: 'usr_1', status: 'queued' };
    const { fetcher, calls } = fakeVideos({ 'POST /users/usr_1/delete-data': () => ({ body: { success: true, result: { job } } }) });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const res = (await (await call('/api/content/users/usr_1/delete-data', { method: 'POST', roles: 'super_admin', json: { resumeToken: 'ignored' } })).json()) as { result: { job: { id: string } } };
    assert.equal(res.result.job.id, 'job_1', 'the job comes back for the UI to follow');
    assert.deepEqual(log.map((r) => JSON.parse(r.new_value).action), ['delete-data']);
    assert.deepEqual(calls.map((c) => c.body), [{}], 'no resume token is passed on');
  });
});

describe('content endpoints: admin jobs', () => {
  const job = (kind: string, targetKind: string, targetId: string) => ({ id: 'job_9', kind, targetKind, targetId, status: 'failed', lastError: 'Bunny down' });

  it('retrying a failed job needs the permissions of the action it runs, and is audited on the item', async () => {
    const { db, log } = fakeDb();
    let current = job('video.purge', 'video', 'v_1');
    const { fetcher, calls } = fakeVideos({
      'GET /jobs/job_9': () => ({ body: { success: true, result: current } }),
      'POST /jobs/job_9/retry': () => ({ body: { success: true, result: { ...current, status: 'queued' } } }),
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    assert.equal((await call('/api/content/jobs/job_9/retry', { method: 'POST', roles: 'moderator' })).status, 403);
    const retried = await call('/api/content/jobs/job_9/retry', { method: 'POST', roles: 'admin', user: 'actor-3' });
    assert.equal(retried.status, 200);
    assert.equal(((await retried.json()) as { result: { status: string } }).result.status, 'queued');
    assert.deepEqual(log.map((r) => [r.key, JSON.parse(r.new_value).action, JSON.parse(r.new_value).details.jobKind]), [['content:video:v_1', 'job-retry', 'video.purge']]);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1);

    current = job('channel.transfer', 'channel', 'ch_1');
    assert.equal((await call('/api/content/jobs/job_9/retry', { method: 'POST', roles: 'admin' })).status, 403, 'only a super admin re-runs a transfer');
    assert.equal((await call('/api/content/jobs/job_9/retry', { method: 'POST', roles: 'super_admin' })).status, 200);
  });

  it('a refused retry leaves no audit row', async () => {
    const { db, log } = fakeDb();
    const { fetcher } = fakeVideos({
      'GET /jobs/job_9': () => ({ body: { success: true, result: job('video.move', 'video', 'v_1') } }),
      'POST /jobs/job_9/retry': () => ({ status: 409, body: { success: false, code: 'job_not_failed', error: 'Only failed jobs can be retried' } }),
    });
    const res = await appFor({ REPORTS_DB: db, VIDEOS: fetcher })('/api/content/jobs/job_9/retry', { method: 'POST', roles: 'admin' });
    assert.equal(res.status, 409);
    assert.equal(log.length, 0);
  });

  it('job lists and the failed count are readable by every admin role', async () => {
    const { fetcher, calls } = fakeVideos({ 'GET /jobs/counts': () => ({ body: { success: true, result: { failed: 2, retrying: 1 } } }) });
    const call = appFor({ REPORTS_DB: fakeDb().db, VIDEOS: fetcher });
    assert.equal((await call('/api/content/jobs?status=failed', { roles: 'moderator' })).status, 200);
    assert.equal(calls[0].search, '?status=failed');
    const counts = (await (await call('/api/content/jobs/counts', { roles: 'moderator' })).json()) as { result: { failed: number } };
    assert.equal(counts.result.failed, 2);
  });

  it('a detail page carries the item\'s latest jobs; when they cannot be read it says unknown, not none', async () => {
    const jobs = [job('channel.sync-holds', 'channel', 'ch_1')];
    let fail = false;
    const { fetcher, calls } = fakeVideos({
      'GET /channels/ch_1': () => ({ body: { success: true, result: channelDetail } }),
      'GET /jobs': () => (fail ? { status: 500, body: { success: false, code: 'internal_error' } } : { body: { success: true, result: { items: jobs } } }),
    });
    const call = appFor({ REPORTS_DB: fakeDb().db, VIDEOS: fetcher });
    const detail = (await (await call('/api/content/channels/ch_1', { roles: 'moderator' })).json()) as { result: { jobs: unknown[] | null } };
    assert.deepEqual(detail.result.jobs, jobs);
    const params = new URLSearchParams(calls.find((c) => c.path === '/jobs')!.search);
    assert.deepEqual([params.get('targetKind'), params.get('targetId')], ['channel', 'ch_1']);
    fail = true;
    const unknown = (await (await call('/api/content/channels/ch_1', { roles: 'moderator' })).json()) as { result: { jobs: unknown[] | null } };
    assert.equal(unknown.result.jobs, null);
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

describe('content endpoints: restore legacy profile fields', () => {
  const USR = 'usr_3a7c71348b164b84a3a4acb3962937e6';
  const USR2 = 'usr_cccccccccccccccccccccccccccccccc';
  const plan = {
    legacyCount: 2,
    pairedCount: 2,
    items: [
      { id: USR, legacyId: '4b623aeb45eb610c8c72cca719e0f6c7', changes: [{ field: 'firstNameLocalized.ar', from: '', to: 'محمود' }, { field: 'lastNameLocalized.ar', from: null, to: 'درويش' }] },
      { id: USR2, legacyId: 'cccccccccccccccccccccccccccccccc', email: 'b@example.com', changes: [{ field: 'bioLocalized.ar', from: '', to: 'نبذة' }] },
    ],
    unmatched: [],
    ambiguousCount: 0,
  };
  const job = { id: 'job_r', kind: 'profiles.restore-legacy', targetKind: 'user', targetId: 'legacy-profiles', status: 'queued' };

  it('the dry run and Run need users:manage; moderators get neither', async () => {
    const { db, log } = fakeDb();
    const { fetcher, calls } = fakeVideos({ 'GET /legacy-profiles/plan': () => ({ body: { success: true, result: plan } }) });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    assert.equal((await call('/api/content/legacy-profiles/plan', { roles: 'moderator' })).status, 403);
    assert.equal((await call('/api/content/legacy-profiles/restore', { method: 'POST', roles: 'moderator', json: {} })).status, 403);
    assert.equal(calls.length, 0);
    const res = await call('/api/content/legacy-profiles/plan', { roles: 'admin' });
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { result: unknown }).result, plan);
    assert.equal(log.length, 0, 'the dry run is not audited: it changes nothing');
  });

  it('Run audits every profile with its planned changes, then queues the fresh plan (never a client change list)', async () => {
    const { db, log } = fakeDb();
    const { fetcher, calls } = fakeVideos({
      'GET /legacy-profiles/plan': () => ({ body: { success: true, result: plan } }),
      'POST /legacy-profiles/restore': () => ({ body: { success: true, result: { job } } }),
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const res = await call('/api/content/legacy-profiles/restore', { method: 'POST', roles: 'admin', user: 'actor-7', json: { ids: [USR], approved: [{ id: USR, fields: ['email'] }] } });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { result: { job: { id: string } } }).result.job.id, 'job_r');

    const sent = calls.find((c) => c.method === 'POST')!.body as { runId: string; approved: unknown[] };
    assert.deepEqual(sent.approved, [{ id: USR, legacyId: '4b623aeb45eb610c8c72cca719e0f6c7', fields: ['firstNameLocalized.ar', 'lastNameLocalized.ar'] }]);
    assert.equal(log.length, 1);
    assert.equal(log[0].key, `content:user:${USR}`);
    assert.equal(log[0].actor_id, 'actor-7');
    assert.deepEqual(JSON.parse(log[0].new_value), {
      action: 'restore-legacy-fields',
      details: { runId: sent.runId, legacyId: '4b623aeb45eb610c8c72cca719e0f6c7', changes: [{ field: 'firstNameLocalized.ar', to: 'محمود' }, { field: 'lastNameLocalized.ar', to: 'درويش' }] },
    });
    assert.deepEqual(JSON.parse(log[0].old_value!), { 'firstNameLocalized.ar': '', 'lastNameLocalized.ar': null });
  });

  it('without ids every planned profile is run; a refused job leaves no audit rows', async () => {
    const { db, log } = fakeDb();
    const { fetcher } = fakeVideos({
      'GET /legacy-profiles/plan': () => ({ body: { success: true, result: plan } }),
      'POST /legacy-profiles/restore': () => ({ status: 409, body: { success: false, code: 'nothing_to_restore', error: 'Nothing left to restore' } }),
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const res = await call('/api/content/legacy-profiles/restore', { method: 'POST', roles: 'super_admin', json: {} });
    assert.equal(res.status, 409);
    assert.equal(log.length, 0);
  });

  it('an empty plan is refused before anything is audited', async () => {
    const { db, log } = fakeDb();
    const { fetcher, calls } = fakeVideos({ 'GET /legacy-profiles/plan': () => ({ body: { success: true, result: { ...plan, items: [] } } }) });
    const res = await appFor({ REPORTS_DB: db, VIDEOS: fetcher })('/api/content/legacy-profiles/restore', { method: 'POST', roles: 'admin', json: {} });
    assert.equal(res.status, 409);
    assert.equal(log.length, 0);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  });
});

describe('content endpoints: creator tiers', () => {
  const tiers = { items: [{ id: 'creator', name: 'Creator', unlimited: false, perHour: 300, perDay: 2000, maxConcurrent: 20, maxChannels: 3 }] };

  it('assigning a tier needs creators:manage, is audited with the previous tier, and the user page reads the history back', async () => {
    const { db, log } = fakeDb();
    let assignment: { tierId: string; source: string } | null = null;
    const { fetcher, calls } = fakeVideos({
      'GET /users/usr_1/creator-tier': () => ({ body: { success: true, result: { assignment } } }),
      'PUT /users/usr_1/creator-tier': (call) => {
        const { tierId, source } = call.body as { tierId: string | null; source: string };
        assignment = tierId ? { tierId, source } : null;
        return { body: { success: true, result: { assignment } } };
      },
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const denied = await call('/api/content/users/usr_1/creator-tier', { method: 'PUT', roles: 'moderator', json: { tierId: 'creator' } });
    assert.equal(denied.status, 403);
    assert.ok(!calls.some((c) => c.method === 'PUT'), 'a moderator change never reaches api-videos');

    assert.equal((await call('/api/content/users/usr_1/creator-tier', { method: 'PUT', roles: 'admin', user: 'admin-7', json: { tierId: 'creator' } })).status, 200);
    assert.equal((await call('/api/content/users/usr_1/creator-tier', { method: 'PUT', roles: 'super_admin', json: { tierId: null } })).status, 200);
    assert.deepEqual(log.map((r) => [r.key, JSON.parse(r.new_value), JSON.parse(r.old_value!)]), [
      ['content:user:usr_1', { action: 'creator-tier', details: { tierId: 'creator', source: 'admin' } }, { tierId: null, source: null }],
      ['content:user:usr_1', { action: 'creator-tier', details: { tierId: null, source: 'admin' } }, { tierId: 'creator', source: 'admin' }],
    ]);
    assert.equal(log[0].actor_id, 'admin-7');
    const page = (await (await call('/api/content/users/usr_1/creator-tier', { roles: 'moderator' })).json()) as { result: { assignment: unknown; audit: { action: string }[] } };
    assert.equal(page.result.assignment, null);
    assert.equal(page.result.audit.length, 2);
  });

  it('editing a tier definition is audited with the previous limits; a refused edit leaves no row', async () => {
    const { db, log } = fakeDb();
    const { fetcher } = fakeVideos({
      'GET /creator-tiers': () => ({ body: { success: true, result: tiers } }),
      'PUT /creator-tiers/creator': (call) =>
        (call.body as { perHour: number }).perHour > 0
          ? { body: { success: true, result: { tier: { ...tiers.items[0], ...(call.body as object) } } } }
          : { status: 400, body: { success: false, code: 'invalid_tier', error: 'perHour must be a whole number from 1 to 100000' } },
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    assert.equal((await call('/api/content/creator-tiers/creator', { method: 'PUT', roles: 'moderator', json: { perHour: 500 } })).status, 403);
    assert.equal((await call('/api/content/creator-tiers/creator', { method: 'PUT', roles: 'admin', json: { perHour: 500 } })).status, 200);
    const bad = await call('/api/content/creator-tiers/creator', { method: 'PUT', roles: 'admin', json: { perHour: 0 } });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { code: string }).code, 'invalid_tier');
    assert.equal(log.length, 1);
    assert.equal(log[0].key, 'content:creator-tier:creator');
    assert.deepEqual(JSON.parse(log[0].old_value!), { perHour: 300 });
  });

  it('a super admin\'s automatic Unlimited is not changed without the explicit confirmation, and the override is audited', async () => {
    const { db, log } = fakeDb();
    let assignment: Record<string, unknown> | null = { userId: 'usr_owner', tierId: 'unlimited', source: 'admin', assignedBy: 'system:super-admin', assignedAt: '2026-11-10T00:00:00Z' };
    const { fetcher, calls } = fakeVideos({
      'GET /users/usr_owner/creator-tier': () => ({ body: { success: true, result: { assignment } } }),
      'PUT /users/usr_owner/creator-tier': (call) => {
        const { tierId } = call.body as { tierId: string | null };
        assignment = tierId ? { tierId, source: 'admin', assignedBy: 'admin-1' } : null;
        return { body: { success: true, result: { assignment } } };
      },
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const refused = await call('/api/content/users/usr_owner/creator-tier', { method: 'PUT', roles: 'admin', json: { tierId: 'creator' } });
    assert.equal(refused.status, 409);
    assert.equal(((await refused.json()) as { code: string }).code, 'super_admin_tier');
    assert.ok(!calls.some((c) => c.method === 'PUT'), 'nothing reaches api-videos');
    assert.equal(log.length, 0, 'no audit row for a refused change');

    const confirmed = await call('/api/content/users/usr_owner/creator-tier', { method: 'PUT', roles: 'admin', json: { tierId: null, confirmSuperAdmin: true } });
    assert.equal(confirmed.status, 200);
    assert.deepEqual(JSON.parse(log[0].new_value), { action: 'creator-tier', details: { tierId: null, source: 'admin', overrodeSuperAdmin: true } });
    assert.deepEqual(JSON.parse(log[0].old_value!), { tierId: 'unlimited', source: 'admin' });
  });

  it('bulk assign: needs creators:manage, audits each user who changes (from the dry run), skips super admins, and drops the rows when api-videos fails', async () => {
    const { db, log } = fakeDb();
    let fail = false;
    const { fetcher, calls } = fakeVideos({
      'POST /creators/tier': (call) => {
        const { userIds, dryRun } = call.body as { userIds: string[]; dryRun?: boolean };
        if (!dryRun && fail) return { status: 503, body: { success: false, code: 'unavailable', error: 'down' } };
        const changed = userIds.filter((id) => id === 'usr_a' || id === 'usr_b').map((userId) => ({ userId, previous: userId === 'usr_b' ? { tierId: 'creator', source: 'admin' } : null }));
        return { body: { success: true, result: { changed, unchanged: userIds.filter((id) => id === 'usr_c'), skippedSuperAdmin: userIds.filter((id) => id === 'usr_owner') } } };
      },
    });
    const call = appFor({ REPORTS_DB: db, VIDEOS: fetcher });
    const userIds = ['usr_a', 'usr_b', 'usr_c', 'usr_owner'];
    assert.equal((await call('/api/content/creators/tier', { method: 'POST', roles: 'moderator', json: { userIds, tierId: 'unlimited' } })).status, 403);
    assert.equal(calls.length, 0);
    assert.equal((await call('/api/content/creators/tier', { method: 'POST', roles: 'admin', json: { userIds: [], tierId: 'creator' } })).status, 400);
    assert.equal((await call('/api/content/creators/tier', { method: 'POST', roles: 'admin', json: { userIds } })).status, 400, 'tierId is required (null removes)');

    const res = await call('/api/content/creators/tier', { method: 'POST', roles: 'admin', user: 'admin-7', json: { userIds, tierId: 'unlimited' } });
    assert.equal(res.status, 200);
    const result = ((await res.json()) as { result: { changed: { userId: string }[]; unchanged: string[]; skippedSuperAdmin: string[] } }).result;
    assert.deepEqual(result.changed.map((ch) => ch.userId), ['usr_a', 'usr_b']);
    assert.deepEqual(result.unchanged, ['usr_c']);
    assert.deepEqual(result.skippedSuperAdmin, ['usr_owner']);
    assert.deepEqual(calls.map((c) => (c.body as { dryRun?: boolean }).dryRun ?? false), [true, false], 'plans, then applies');
    assert.deepEqual((calls[1].body as { userIds: string[] }).userIds, ['usr_a', 'usr_b'], 'applies only the planned changes');
    assert.deepEqual(log.map((r) => [r.key, JSON.parse(r.old_value!).tierId, r.actor_id]), [
      ['content:user:usr_a', null, 'admin-7'],
      ['content:user:usr_b', 'creator', 'admin-7'],
    ]);
    const details = JSON.parse(log[0].new_value).details as { tierId: string; bulk: string };
    assert.equal(details.tierId, 'unlimited');
    assert.ok(details.bulk, 'rows of one bulk change share its run id');

    fail = true;
    const failed = await call('/api/content/creators/tier', { method: 'POST', roles: 'admin', json: { userIds, tierId: null } });
    assert.equal(failed.status, 503);
    assert.equal(log.length, 2, 'the failed bulk change left no audit rows');
  });

  it('every admin role reads the Creators list and the tiers; creators:manage is listed for admins only', async () => {
    const { fetcher, calls } = fakeVideos({ 'GET /creator-tiers': () => ({ body: { success: true, result: tiers } }) });
    const call = appFor({ REPORTS_DB: fakeDb().db, VIDEOS: fetcher });
    assert.equal((await call('/api/content/creators?filter=needs_tier', { roles: 'moderator' })).status, 200);
    assert.equal(calls.find((c) => c.path === '/creators')?.search, '?filter=needs_tier');
    assert.equal((await call('/api/content/creator-tiers', { roles: 'moderator' })).status, 200);
    const read = async (roles: string) => ((await (await call('/api/content/permissions', { roles })).json()) as { result: { permissions: string[] } }).result.permissions;
    assert.ok((await read('admin')).includes('creators:manage'));
    assert.ok(!(await read('moderator')).includes('creators:manage'));
  });
});
