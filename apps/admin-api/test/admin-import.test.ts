/**
 * /api/admin/import/* (Admin Tools, wiki TOOLS-ADMIN): imports:manage on every route, channels:manage
 * to make a channel, the audit row written first and pointed at the new channel (or dropped when
 * api-videos refuses), the acting admin's profile made on first use, and the encode settings.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { ENCODE_LADDER, PREBUILT_LIMITS } from '@al-ummah/shared-types';
import adminImportRouter, { parseNewChannel, parseNewItem, toolsErrorEvents } from '../src/routers/adminImport.router';
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
    for (const [path, init] of [['/api/admin/import/me'], ['/api/admin/import/encoding'], ['/api/admin/import/quran-index'], ['/api/admin/import/channels', post({ name: 'X' })]] as const) {
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

  it('GET /quran-index passes the index through as api-videos sends it, never cached', async () => {
    const payload = { success: true, result: { index: { v: 1, version: 'v1', syncedAt: '2026-11-20T00:00:00.000Z', words: 'ابج دهو', locs: [1001001, 1001002] }, expiresAt: '2026-11-27T00:00:00.000Z' } };
    const seen: string[] = [];
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('auth' as never, { userId: ADMIN, roles: ['Admin'] } as never); await next(); });
    app.route('/api/admin/import', adminImportRouter);
    const env = { INTERNAL_API_KEY: 'k', VIDEOS: { async fetch(input: string, init?: RequestInit) { seen.push(`${new URL(input).pathname} ${new Headers(init?.headers).get('X-Admin-Actor')}`); return new Response(JSON.stringify(payload)); } } };
    const res = await app.request('/api/admin/import/quran-index', {}, env as never);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(await res.json(), payload);
    assert.deepEqual(seen, [`/internal/admin/import/quran-index ${ADMIN}`]);
  });

  it('GET /quran-index answers 503 quran_index_unavailable while there is no fresh copy', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('auth' as never, { userId: ADMIN, roles: ['Admin'] } as never); await next(); });
    app.route('/api/admin/import', adminImportRouter);
    const env = { INTERNAL_API_KEY: 'k', VIDEOS: { fetch: async () => new Response(JSON.stringify({ success: false, code: 'quran_index_unavailable', error: 'x' }), { status: 503 }) } };
    const res = await app.request('/api/admin/import/quran-index', {}, env as never);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'quran_index_unavailable');
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

describe('/api/admin/import/items/:id/sidecars (TA-6)', () => {
  it('queues the attach job for the item\'s video, audits what arrived (never the contents) and records the job', async () => {
    const db = sqliteD1();
    const calls: { path: string; body: any }[] = [];
    let refuse = false;
    const env = {
      REPORTS_DB: db,
      INTERNAL_API_KEY: 'k',
      VIDEOS: {
        async fetch(input: string, init?: RequestInit) {
          const url = new URL(input);
          calls.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
          if (refuse) return new Response(JSON.stringify({ success: false, code: 'invalid_request', error: 'Nothing to attach' }), { status: 400 });
          return new Response(JSON.stringify({ success: true, result: { jobId: 'job-9', status: 'queued' } }), { status: 200 });
        },
      },
    };
    const t = new Date().toISOString();
    await db.prepare("INSERT INTO import_items (id, batch_id, channel_id, sha256, file_name, file_size, video_id, state, created_by, created_at, updated_at) VALUES ('it1','b1','ch1',?, 'a.mp4', 1, 'vid-1', 'uploaded', ?, ?, ?)").bind('e'.repeat(64), ADMIN, t, t).run();
    await db.prepare("INSERT INTO import_items (id, batch_id, channel_id, sha256, file_name, file_size, state, created_by, created_at, updated_at) VALUES ('it2','b1','ch1',?, 'b.mp4', 1, 'failed', ?, ?, ?)").bind('d'.repeat(64), ADMIN, t, t).run();
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId: ADMIN, roles: ['Admin'] } as never);
      await next();
    });
    app.route('/api/admin/import', adminImportRouter);
    const send = async (id: string, body: unknown) => {
      const res = await app.request(`/api/admin/import/items/${id}/sidecars`, post(body), env as never);
      return { status: res.status, body: (await res.json()) as any };
    };
    const sidecars = { captions: [{ language: 'ar', content: 'WEBVTT\n\nسر' }], chapters: '0:00 Intro', thumbnail: { data: 'AAAA', mimeType: 'image/png' } };
    const res = await send('it1', sidecars);
    assert.equal(res.status, 202);
    assert.equal(res.body.result.jobId, 'job-9');
    assert.equal(res.body.result.item.attachJobId, 'job-9');
    assert.deepEqual(calls[0], { path: '/internal/admin/import/videos/vid-1/sidecars', body: sidecars });
    const [row] = (await db.prepare("SELECT key, new_value FROM site_settings_log").all<any>()).results ?? [];
    assert.equal(row.key, 'content:import:vid-1');
    assert.deepEqual(JSON.parse(row.new_value).details, { itemId: 'it1', captions: ['ar'], chapters: true, thumbnail: true });
    assert.ok(!row.new_value.includes('WEBVTT') && !row.new_value.includes('AAAA'), 'no file contents in the audit log');
    assert.equal((await send('it2', sidecars)).body.code, 'no_video');
    assert.equal((await send('none', sidecars)).status, 404);
    refuse = true;
    assert.equal((await send('it1', {})).status, 400);
    assert.equal(((await db.prepare("SELECT COUNT(*) AS n FROM site_settings_log").first<any>())).n, 1, 'the refused call left no audit row');
  });
});

describe('/api/admin/import/items/:id/transcript and /translations (TA-7)', () => {
  it('forwards a keys-only transcript and translation requests, auditing counts and languages only', async () => {
    const db = sqliteD1();
    const calls: { path: string; body: any }[] = [];
    let answer: () => Response = () => new Response(JSON.stringify({ success: true, result: { status: 'queued', segments: 2 } }), { status: 200 });
    const env = {
      REPORTS_DB: db,
      INTERNAL_API_KEY: 'k',
      VIDEOS: {
        async fetch(input: string, init?: RequestInit) {
          calls.push({ path: new URL(input).pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
          return answer();
        },
      },
    };
    const t = new Date().toISOString();
    await db.prepare("INSERT INTO import_items (id, batch_id, channel_id, sha256, file_name, file_size, video_id, state, created_by, created_at, updated_at) VALUES ('it1','b1','ch1',?, 'a.mp4', 1, 'vid-1', 'uploaded', ?, ?, ?)").bind('e'.repeat(64), ADMIN, t, t).run();
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId: ADMIN, roles: ['Admin'] } as never);
      await next();
    });
    app.route('/api/admin/import', adminImportRouter);
    const send = async (path: string, body: unknown) => {
      const res = await app.request(`/api/admin/import/items/${path}`, post(body), env as never);
      return { status: res.status, body: (await res.json()) as any };
    };
    const transcript = {
      language: 'ar',
      segments: [{ startMs: 0, endMs: 1000, text: 'قال الشيخ' }, { startMs: 1000, endMs: 4000, quran: { range: '112:1:1-112:4:5' } }],
      engine: { provider: 'whisper.cpp' },
    };
    const res = await send('it1/transcript', transcript);
    assert.equal(res.status, 202);
    assert.deepEqual(calls[0], { path: '/internal/admin/import/videos/vid-1/captions/ar/transcript', body: { segments: transcript.segments, engine: transcript.engine } });
    answer = () => new Response(JSON.stringify({ success: true, result: { results: [{ language: 'en', jobId: 'j1', status: 'queued', existing: false }] } }), { status: 200 });
    const tr = await send('it1/translations', { sourceLanguage: 'ar', languages: ['en'] });
    assert.equal(tr.status, 200);
    assert.equal(tr.body.result.results[0].jobId, 'j1');
    assert.equal(calls[1]!.path, '/internal/admin/import/videos/vid-1/translations');
    const rows = (await db.prepare("SELECT new_value FROM site_settings_log ORDER BY rowid").all<any>()).results ?? [];
    assert.deepEqual(JSON.parse(rows[0].new_value).details, { itemId: 'it1', language: 'ar', segments: 2 });
    assert.deepEqual(JSON.parse(rows[1].new_value).details, { itemId: 'it1', sourceLanguage: 'ar', languages: ['en'] });
    assert.ok(!rows[0].new_value.includes('الشيخ'), 'no transcript text in the audit log');
    // A refusal from api-videos passes through and leaves no audit row
    answer = () => new Response(JSON.stringify({ success: false, code: 'draft_exists', error: 'draft_exists' }), { status: 409 });
    const refused = await send('it1/transcript', transcript);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'draft_exists');
    assert.equal((await send('it1/transcript', { ...transcript, language: '' })).status, 400);
    assert.equal(((await db.prepare("SELECT COUNT(*) AS n FROM site_settings_log").first<any>())).n, 2);
  });
});

describe('/api/admin/import/items/:id/renditions and /delivery (TA-12)', () => {
  const STAGING = '0123456789abcdef';
  async function harness() {
    const db = sqliteD1();
    const calls: { path: string; method: string; type: string | null; length: string | null; bytes: number | null; json: any }[] = [];
    let answer: (path: string, method: string) => Response = (path, method) => {
      if (method === 'PUT') return new Response(null, { status: 204 });
      if (path.endsWith('/delivery')) return Response.json({ success: true, result: { takesRenditions: !path.includes('/channels/chB/') } });
      return Response.json({ success: true, result: { stagingId: STAGING, status: path.endsWith('/complete') ? 'ready' : 'uploading' } }, { status: method === 'POST' && path.endsWith('/renditions') ? 201 : 200 });
    };
    const env = {
      REPORTS_DB: db,
      INTERNAL_API_KEY: 'k',
      VIDEOS: {
        async fetch(input: string, init?: RequestInit) {
          const url = new URL(input);
          const method = init?.method ?? 'GET';
          const headers = new Headers(init?.headers);
          let bytes: number | null = null;
          let json: any = null;
          if (init?.body) {
            const buf = await new Response(init.body).arrayBuffer();
            if (headers.get('Content-Type') === 'application/json') json = JSON.parse(new TextDecoder().decode(buf));
            else bytes = buf.byteLength;
          }
          calls.push({ path: url.pathname, method, type: headers.get('Content-Type'), length: headers.get('Content-Length'), bytes, json });
          return answer(url.pathname, method);
        },
      },
    };
    const t = new Date().toISOString();
    await db.prepare("INSERT INTO import_items (id, batch_id, channel_id, sha256, file_name, file_size, video_id, state, created_by, created_at, updated_at) VALUES ('it1','b1','ch1',?, 'a.mp4', 1, 'vid-1', 'initiated', ?, ?, ?)").bind('e'.repeat(64), ADMIN, t, t).run();
    await db.prepare("INSERT INTO import_items (id, batch_id, channel_id, sha256, file_name, file_size, video_id, state, created_by, created_at, updated_at) VALUES ('it2','b1','ch1',?, 'b.mp4', 1, NULL, 'initiated', ?, ?, ?)").bind('f'.repeat(64), ADMIN, t, t).run();
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId: ADMIN, roles: ['Admin'] } as never);
      await next();
    });
    app.route('/api/admin/import', adminImportRouter);
    const req = (path: string, init?: RequestInit) => app.request(`/api/admin/import${path}`, init, env as never);
    const audit = async () => ((await db.prepare('SELECT key, new_value FROM site_settings_log ORDER BY rowid').all<any>()).results ?? []).map((r: any) => ({ key: r.key, ...JSON.parse(r.new_value) }));
    return { req, calls, audit, setAnswer: (a: typeof answer) => (answer = a) };
  }
  const plan = { rungs: ['360p'], files: [{ path: '360p/index.m3u8', bytes: 4 }], encoder: 'libx264' };

  it('stages for the item\'s video (audited: rungs and counts), streams each file, completes, and reads delivery', async () => {
    const h = await harness();
    const staged = await h.req('/items/it1/renditions', post(plan));
    assert.equal(staged.status, 201);
    assert.equal((await staged.json()).result.stagingId, STAGING);
    assert.deepEqual(h.calls[0], { path: '/internal/admin/import/videos/vid-1/renditions', method: 'POST', type: 'application/json', length: null, bytes: null, json: plan });

    const put = await h.req(`/items/it1/renditions/${STAGING}/files/360p/index.m3u8`, { method: 'PUT', body: new Uint8Array(4), headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': '4' } });
    assert.equal(put.status, 204);
    assert.deepEqual(h.calls[1], { path: `/internal/admin/import/videos/vid-1/renditions/${STAGING}/files/360p/index.m3u8`, method: 'PUT', type: 'application/vnd.apple.mpegurl', length: '4', bytes: 4, json: null });

    const done = await h.req(`/items/it1/renditions/${STAGING}/complete`, { method: 'POST' });
    assert.equal((await done.json()).result.status, 'ready');
    const delivery = await (await h.req('/items/it1/delivery')).json();
    assert.equal(delivery.result.takesRenditions, true);
    assert.equal(h.calls[3]!.path, '/internal/admin/import/videos/vid-1/delivery');

    const rows = await h.audit();
    assert.equal(rows.length, 1, 'staging is audited; files, complete and reads are not');
    assert.deepEqual(rows[0], { key: 'content:import:vid-1', action: 'renditions:stage', details: { itemId: 'it1', rungs: ['360p'], files: 1, encoder: 'libx264' } });
  });

  it('passes files_missing through with its list, and cancel is audited (dropped when refused)', async () => {
    const h = await harness();
    h.setAnswer(() => Response.json({ success: false, code: 'files_missing', error: 'files_missing', missing: ['360p/index.m3u8'] }, { status: 409 }));
    const early = await h.req(`/items/it1/renditions/${STAGING}/complete`, { method: 'POST' });
    assert.equal(early.status, 409);
    assert.deepEqual(await early.json(), { success: false, code: 'files_missing', error: 'files_missing', missing: ['360p/index.m3u8'] });
    h.setAnswer(() => Response.json({ success: false, code: 'too_late', error: 'too_late' }, { status: 409 }));
    assert.equal((await h.req(`/items/it1/renditions/${STAGING}`, { method: 'DELETE' })).status, 409);
    assert.equal((await h.audit()).length, 0);
    h.setAnswer(() => Response.json({ success: true, result: {} }));
    assert.equal((await h.req(`/items/it1/renditions/${STAGING}`, { method: 'DELETE' })).status, 200);
    assert.equal((await h.audit())[0].action, 'renditions:cancel');
  });

  it('refuses before api-videos: no item, no video yet, a bad staging id, file name or size', async () => {
    const h = await harness();
    assert.equal((await h.req('/items/nope/renditions', post(plan))).status, 404);
    assert.equal((await h.req('/items/it2/renditions', post(plan))).status, 409);
    assert.equal((await h.req('/items/it1/renditions/XYZ/complete', { method: 'POST' })).status, 404);
    for (const path of ['4k/seg.m4s', '360p/.hidden', '360p/a%2Fb']) {
      assert.equal((await h.req(`/items/it1/renditions/${STAGING}/files/${path}`, { method: 'PUT', body: new Uint8Array(1) })).status, 400, path);
    }
    const unsized = await h.req(`/items/it1/renditions/${STAGING}/files/360p/seg_00001.m4s`, { method: 'PUT', body: new Uint8Array(1) });
    assert.equal(unsized.status, 411);
    const big = await h.req(`/items/it1/renditions/${STAGING}/files/360p/seg_00001.m4s`, { method: 'PUT', body: new Uint8Array(1), headers: { 'Content-Length': String(PREBUILT_LIMITS.maxFileBytes + 1) } });
    assert.equal(big.status, 413);
    assert.equal(h.calls.length, 0);
  });

  it('GET /encoding?channelId= says whether the channel takes renditions', async () => {
    const h = await harness();
    assert.equal((await (await h.req('/encoding?channelId=chB')).json()).result.takesRenditions, false);
    assert.equal((await (await h.req('/encoding?channelId=chA')).json()).result.takesRenditions, true);
    assert.equal(h.calls[0]!.path, '/internal/admin/import/channels/chB/delivery');
    assert.equal('takesRenditions' in (await (await h.req('/encoding')).json()).result, false);
  });
});

describe('/api/admin/import/errors (TA-11)', () => {
  function errorsSetup(roles: string[] = ['Admin'], environment = 'production') {
    const sent: any[] = [];
    const env = { REPORTS_DB: sqliteD1(), INTERNAL_API_KEY: 'k', ENVIRONMENT: environment, ERRORS_QUEUE: { async send(msg: unknown) { sent.push(msg); } } };
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId: ADMIN, email: 'staff@example.com', roles } as never);
      await next();
    });
    app.route('/api/admin/import', adminImportRouter);
    const req = async (json: unknown, raw?: string) => {
      const res = await app.request('/api/admin/import/errors', { method: 'POST', body: raw ?? JSON.stringify(json), headers: { 'Content-Type': 'application/json', 'User-Agent': 'AlUmmahNowTools/1.0' } }, env as never);
      return { status: res.status, body: (await res.json()) as any };
    };
    return { req, sent };
  }
  const event = (over: Record<string, unknown> = {}) => ({ kind: 'upload', ref: 'ERR-AB12-CD34', message: 'Upload of lesson-01.mp4 failed: 503', release: '1.0.0', ...over });

  it('queues the app\'s reports as app tools, under the token\'s account and never the body\'s', async () => {
    const { req, sent } = errorsSetup();
    const res = await req({ events: [event({ userId: OWNER, app: 'admin-api' })] });
    assert.equal(res.status, 202);
    assert.deepEqual(res.body.result, { accepted: 1, rateLimited: 0 });
    assert.equal(sent.length, 1);
    const [queued] = sent[0].events;
    assert.equal(queued.app, 'tools');
    assert.equal(queued.userId, ADMIN);
    assert.equal(queued.ref, 'ERR-AB12-CD34');
    assert.equal(sent[0].trustedRetry, false, 'the app cannot attach Retry actions');
    assert.equal(sent[0].userAgent, 'AlUmmahNowTools/1.0');
  });

  it('keeps only the app\'s own kinds, gives a reference when none came, and drops needs-action items', () => {
    const events = toolsErrorEvents(
      [event({ ref: undefined }), event({ kind: 'http' }), event({ kind: 'action', action: { key: 'x', source: 'upload', title: 'X' } }), 'nonsense', event({ message: '' })],
      { userId: ADMIN, environment: 'qa' },
    );
    assert.equal(events.length, 1);
    assert.match(events[0].ref, /^ERR-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.equal(events[0].action, undefined);
  });

  it('caps the repeat count and drops the app\'s origin and "shown" claims', () => {
    const [e] = toolsErrorEvents([event({ count: 9999, shown: true, context: { origin: { source: 'search' }, ids: { videoId: 'vid12345' } } })], { userId: ADMIN, environment: 'qa' });
    assert.equal(e.count, 50);
    assert.equal(e.shown, undefined);
    assert.equal((e.context as any)?.origin, undefined);
  });

  it('honours "test" outside production only', () => {
    assert.equal(toolsErrorEvents([event({ test: true })], { userId: ADMIN, environment: 'production' })[0].test, undefined);
    assert.equal(toolsErrorEvents([event({ test: true })], { userId: ADMIN, environment: 'qa' })[0].test, true);
  });

  it('refuses non-staff, bad bodies and too many reports at once', async () => {
    assert.equal((await errorsSetup(['Moderator']).req({ events: [event()] })).status, 403);
    const { req, sent } = errorsSetup();
    assert.equal((await req(null, '{nope')).status, 400);
    assert.equal((await req({ events: [event({ kind: 'http' })] })).status, 400);
    assert.equal((await req({ events: Array.from({ length: 21 }, () => event()) })).status, 413);
    assert.equal((await req(null, JSON.stringify({ events: [event({ message: 'x'.repeat(70 * 1024) })] }))).status, 413);
    assert.equal(sent.length, 0);
  });

  it('applies the per-client minute limit to an account', async () => {
    const { req } = errorsSetup();
    let limited = false;
    for (let i = 0; i < 20 && !limited; i++) {
      const res = await req({ events: Array.from({ length: 20 }, () => event()) });
      if (res.status === 429) limited = true;
      else assert.equal(res.status, 202);
    }
    assert.ok(limited, 'a flood of reports is cut off within the minute');
  });
});
