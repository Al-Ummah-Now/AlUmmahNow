/**
 * /api/admin/import/* (Admin Tools, wiki TOOLS-ADMIN): imports:manage on every route, channels:manage
 * to make a channel, the audit row written first and pointed at the new channel (or dropped when
 * api-videos refuses), the acting admin's profile made on first use, and the encode settings.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { ENCODE_LADDER, PREBUILT_LIMITS } from '@al-ummah/shared-types';
import adminImportRouter, { parseNewChannel, parseNewItem } from '../src/routers/adminImport.router';
import { sqliteD1 } from './d1-sqlite';

const ADMIN = 'usr_' + 'a'.repeat(32);
const OWNER = 'usr_' + 'b'.repeat(32);

function setup(roles: string[], videos: { noProfile?: boolean; refuse?: { status: number; code: string } } = {}) {
  const calls: { path: string; method: string; body: any; actor: string | null }[] = [];
  let profileMade = !videos.noProfile;
  const env = {
    REPORTS_DB: sqliteD1(),
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const url = new URL(input);
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ path: url.pathname, method, body, actor: new Headers(init?.headers).get('X-Admin-Actor') });
        const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status });
        if (url.pathname === '/internal/admin/users/provision') {
          profileMade = true;
          return json(200, { success: true, result: { profile: { id: body.userId }, created: true } });
        }
        if (videos.refuse) return json(videos.refuse.status, { success: false, code: videos.refuse.code, error: 'refused' });
        if (!profileMade) return json(404, { success: false, code: 'user_not_found', error: 'The user has no videos profile' });
        return json(200, { success: true, result: { channel: { id: 'ch_new', name: body.name, handle: body.handle ?? 'auto' } } });
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: ADMIN, email: 'staff@example.com', roles } as never);
    await next();
  });
  app.route('/api/admin/import', adminImportRouter);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const audit = async () => (await env.REPORTS_DB.prepare('SELECT key, new_value, actor_id FROM site_settings_log').all<any>()).results ?? [];
  return { req, calls, audit };
}

const post = (json: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });

describe('/api/admin/import', () => {
  it('refuses moderators on every route before calling api-videos', async () => {
    const { req, calls } = setup(['Moderator']);
    for (const [path, init] of [['/api/admin/import/me'], ['/api/admin/import/encoding'], ['/api/admin/import/channels', post({ name: 'X' })]] as const) {
      const res = await req(path, init);
      assert.equal(res.status, 403, path);
      assert.equal((await res.json()).code, 'forbidden');
    }
    assert.equal(calls.length, 0);
  });

  it('GET /me names the admin and what they may do', async () => {
    const { req } = setup(['Admin']);
    const { result } = await (await req('/api/admin/import/me')).json();
    assert.equal(result.userId, ADMIN);
    assert.deepEqual(result.roles, ['admin']);
    assert.ok(result.permissions.includes('imports:manage'));
    assert.ok(!result.permissions.includes('import_sources:manage'), 'social sources are super admin only');
    assert.ok(result.contentPermissions.includes('channels:manage'));
    const sup = await (await setup(['Super Admin']).req('/api/admin/import/me')).json();
    assert.ok(sup.result.permissions.includes('import_sources:manage'));
  });

  it('GET /encoding serves the shared ladder and the pre-encoded upload limits', async () => {
    const { result } = await (await setup(['Admin']).req('/api/admin/import/encoding')).json();
    assert.deepEqual(result.ladder, JSON.parse(JSON.stringify(ENCODE_LADDER)));
    assert.deepEqual(result.prebuiltLimits, JSON.parse(JSON.stringify(PREBUILT_LIMITS)));
  });

  it('POST /channels makes a channel for a chosen owner, audited under the channel id', async () => {
    const { req, calls, audit } = setup(['Admin']);
    const res = await req('/api/admin/import/channels', post({ name: '  Lessons  ', handle: 'lessons', ownerId: OWNER }));
    assert.equal(res.status, 201);
    assert.deepEqual((await res.json()).result.channel, { id: 'ch_new', name: 'Lessons', handle: 'lessons' });
    assert.deepEqual(calls, [{ path: `/internal/admin/users/${OWNER}/channels`, method: 'POST', body: { name: 'Lessons', handle: 'lessons' }, actor: ADMIN }]);
    const [row] = await audit();
    assert.equal(row.key, 'content:import:ch_new');
    assert.equal(row.actor_id, ADMIN);
    assert.deepEqual(JSON.parse(row.new_value), { action: 'channel:create', details: { ownerId: OWNER, name: 'Lessons', handle: 'lessons' } });
  });

  it('POST /channels without an owner makes the admin\'s videos profile first when it is missing', async () => {
    const { req, calls } = setup(['Super Admin'], { noProfile: true });
    assert.equal((await req('/api/admin/import/channels', post({ name: 'Mine' }))).status, 201);
    assert.deepEqual(calls.map((x) => x.path), [`/internal/admin/users/${ADMIN}/channels`, '/internal/admin/users/provision', `/internal/admin/users/${ADMIN}/channels`]);
    assert.deepEqual(calls[1].body, { userId: ADMIN, email: 'staff@example.com' });
  });

  it('POST /channels for a chosen owner without a profile is a 404, never a new profile', async () => {
    const { req, calls, audit } = setup(['Admin'], { noProfile: true });
    const res = await req('/api/admin/import/channels', post({ name: 'X', ownerId: OWNER }));
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'user_not_found');
    assert.equal(calls.length, 1);
    assert.equal((await audit()).length, 0, 'the audit row of a refused change is dropped');
  });

  it('POST /channels passes on api-videos refusals (duplicate name) and leaves no audit row', async () => {
    const { req, audit } = setup(['Admin'], { refuse: { status: 409, code: 'duplicate_channel_name' } });
    const res = await req('/api/admin/import/channels', post({ name: 'Taken' }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'duplicate_channel_name');
    assert.equal((await audit()).length, 0);
  });

  it('POST /channels for another owner is allowed to admins, who hold users:manage (as an invite needs)', async () => {
    const { req, calls } = setup(['Admin']);
    assert.equal((await req('/api/admin/import/channels', post({ name: 'X', ownerId: OWNER }))).status, 201);
    assert.equal(calls.length, 1);
  });

  it('validates the new channel before calling api-videos', async () => {
    const { req, calls } = setup(['Admin']);
    assert.equal((await req('/api/admin/import/channels', post({ name: ' ' }))).status, 400);
    assert.equal((await req('/api/admin/import/channels', post({ name: 'x'.repeat(101) }))).status, 400);
    assert.equal((await req('/api/admin/import/channels', post({ name: 'X', ownerId: '../admin' }))).status, 400);
    assert.equal(calls.length, 0);
    assert.deepEqual(parseNewChannel({ name: 'A', handle: ' ', description: 'd' }), { ok: true, value: { name: 'A', description: 'd' } });
    assert.equal(parseNewChannel({ name: 'A', handle: 5 }).ok, false);
  });
});

describe('/api/admin/import batches and items (TA-5)', () => {
  const SHA = 'f'.repeat(64);
  const FILE = { sha256: SHA, fileName: 'lesson-01.mp4', fileSize: 4096, mimeType: 'video/mp4', title: 'Lesson 1', fingerprint: { name: 'lesson-01.mp4', size: 4096, lastModified: 1, hash: 'c'.repeat(64) } };

  function importSetup(opts: { refuseInitiate?: boolean; noChannel?: boolean } = {}) {
    const calls: { path: string; method: string; body: any; actor: string | null }[] = [];
    let n = 0;
    const videos = new Map<string, string>();
    const env = {
      REPORTS_DB: sqliteD1(),
      INTERNAL_API_KEY: 'k',
      VIDEOS: {
        async fetch(input: string, init?: RequestInit) {
          const url = new URL(input);
          const method = init?.method ?? 'GET';
          const body = init?.body ? JSON.parse(String(init.body)) : null;
          calls.push({ path: url.pathname, method, body, actor: new Headers(init?.headers).get('X-Admin-Actor') });
          const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status });
          if (url.pathname.startsWith('/internal/admin/channels/')) {
            return opts.noChannel ? json(404, { success: false, code: 'channel_not_found', error: 'No such channel' }) : json(200, { success: true, result: { id: 'ch1' } });
          }
          if (url.pathname === '/internal/admin/import/initiate') {
            if (opts.refuseInitiate) return json(409, { success: false, code: 'channel_suspended', error: 'The channel is suspended' });
            const key = body.fingerprint?.hash ?? String(++n);
            const reused = videos.has(key);
            if (!reused) videos.set(key, `vid-${videos.size + 1}`);
            return json(200, { success: true, result: { videoId: videos.get(key), tusSessionId: `sess-${++n}`, chunkSize: 1, resumable: true, reused } });
          }
          return json(404, { success: false, code: 'not_found', error: url.pathname });
        },
      },
    };
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId: ADMIN, email: 'staff@example.com', roles: ['Admin'] } as never);
      await next();
    });
    app.route('/api/admin/import', adminImportRouter);
    const req = async (path: string, init?: RequestInit) => {
      const res = await app.request(path, init, env as never);
      return { status: res.status, body: (await res.json()) as any };
    };
    const audit = async () => (await env.REPORTS_DB.prepare('SELECT key, new_value FROM site_settings_log ORDER BY created_at').all<any>()).results ?? [];
    return { req, calls, audit };
  }

  it('a batch for a channel, then a file: the normal upload for the channel, audited under the video', async () => {
    const h = importSetup();
    const made = await h.req('/api/admin/import/batches', post({ channelId: 'ch1', name: 'Archive 2019' }));
    assert.equal(made.status, 201);
    const batchId = made.body.result.batch.id;
    const res = await h.req(`/api/admin/import/batches/${batchId}/items`, post({ ...FILE, description: 'd', ignored: 'x' }));
    assert.equal(res.status, 201);
    assert.equal(res.body.result.item.videoId, 'vid-1');
    assert.equal(res.body.result.upload.tusSessionId.startsWith('sess-'), true);
    const initiate = h.calls.find((x) => x.path === '/internal/admin/import/initiate')!;
    assert.equal(initiate.actor, ADMIN);
    assert.deepEqual(Object.keys(initiate.body).sort(), ['channelId', 'description', 'fileSize', 'fingerprint', 'mimeType', 'title']);
    assert.equal(initiate.body.channelId, 'ch1');
    const keys = (await h.audit()).map((r: any) => r.key).sort();
    assert.deepEqual(keys, [`content:import:batch:${batchId}`, 'content:import:vid-1'].sort());
    const detail = await h.req(`/api/admin/import/batches/${batchId}`);
    assert.equal(detail.body.result.items.length, 1);
    assert.equal(detail.body.result.items[0].state, 'initiated');
  });

  it('the same file again resumes its video, and once uploaded is refused as already imported (any batch)', async () => {
    const h = importSetup();
    const b1 = (await h.req('/api/admin/import/batches', post({ channelId: 'ch1' }))).body.result.batch.id;
    const first = await h.req(`/api/admin/import/batches/${b1}/items`, post(FILE));
    const again = await h.req(`/api/admin/import/batches/${b1}/items`, post({ ...FILE, sha256: SHA.toUpperCase() }));
    assert.equal(again.status, 200);
    assert.equal(again.body.result.item.id, first.body.result.item.id);
    assert.equal(again.body.result.upload.reused, true);
    assert.equal((await h.req(`/api/admin/import/items/${first.body.result.item.id}/uploaded`, post({}))).body.result.item.state, 'uploaded');
    const b2 = (await h.req('/api/admin/import/batches', post({ channelId: 'ch1' }))).body.result.batch.id;
    const dup = await h.req(`/api/admin/import/batches/${b2}/items`, post(FILE));
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'already_imported');
    assert.equal(dup.body.item.videoId, 'vid-1');
    assert.equal(h.calls.filter((x) => x.path === '/internal/admin/import/initiate').length, 2, 'never initiated a third time');
    // A failed mark cannot undo an upload
    assert.equal((await h.req(`/api/admin/import/items/${first.body.result.item.id}/failed`, post({ error: 'x' }))).status, 409);
    const list = await h.req('/api/admin/import/batches?channelId=ch1');
    assert.deepEqual(list.body.result.batches.map((b: any) => b.counts), [{}, { uploaded: 1 }]);
  });

  it('a refused initiate leaves the item failed with the reason and no audit row for it', async () => {
    const h = importSetup({ refuseInitiate: true });
    const b = (await h.req('/api/admin/import/batches', post({ channelId: 'ch1' }))).body.result.batch.id;
    const res = await h.req(`/api/admin/import/batches/${b}/items`, post(FILE));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'channel_suspended');
    const [item] = (await h.req(`/api/admin/import/batches/${b}`)).body.result.items;
    assert.equal(item.state, 'failed');
    assert.match(item.error, /suspended/);
    assert.equal((await h.audit()).length, 1, 'only the batch');
  });

  it('validates batches and files, and a batch needs an existing channel', async () => {
    const h = importSetup({ noChannel: true });
    assert.equal((await h.req('/api/admin/import/batches', post({}))).status, 400);
    assert.equal((await h.req('/api/admin/import/batches', post({ channelId: 'nope' }))).status, 404);
    assert.equal((await h.req('/api/admin/import/batches/none/items', post(FILE))).status, 404);
    assert.equal((await h.req('/api/admin/import/items/none/uploaded', post({}))).status, 404);
    assert.equal(parseNewItem({ ...FILE, sha256: 'abc' }).ok, false);
    assert.equal(parseNewItem({ ...FILE, fileSize: 1.5 }).ok, false);
    assert.equal(parseNewItem({ ...FILE, mimeType: 'image/png' }).ok, false);
    assert.equal(parseNewItem({ ...FILE, title: ' ' }).ok, false);
    assert.equal(parseNewItem(FILE).ok, true);
  });
});
