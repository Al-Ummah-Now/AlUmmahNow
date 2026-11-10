/**
 * Creator tiers on the upload and channel-create paths (middleware/upload-limits.ts,
 * lib/creatorTiers.ts, endpoints/creator/creatorAccess.ts). Runs the real
 * middlewares (as mounted in index.ts) and the real TUS proxy router against
 * D1 (node:sqlite with the search migrations), in-memory KV for TUS sessions
 * and a stubbed Bunny.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { CREATOR_ERROR_CODES, DEFAULT_CREATOR_TIER } from '@al-ummah/shared-types';
import {
  continueLimitsOf,
  countReused,
  MAX_BATCH_SIZE,
  refundUploadSession,
  CLIENT_REFUNDS_PER_DAY,
  sessionLimitsOf,
  UPLOAD_CONTINUE_PATHS,
  UPLOAD_SESSION_OPERATION,
  UPLOAD_SESSION_PATHS,
  uploadContinueLimitMiddleware,
  uploadLimitsEnforced,
  uploadSessionLimitMiddleware,
  UPLOADS_BY_INVITATION_MESSAGE,
} from '../src/middleware/upload-limits';
import { assignTier, deleteTier, readTier, readTiers, resolveCreator, saveTier, validateTier } from '../src/lib/creatorTiers';
import { channelCreateGate, creatorAccess } from '../src/endpoints/creator/creatorAccess';
import { listCreators } from '../src/lib/admin/creators';
import { createTusRouter } from '../src/endpoints/video/tus/tusProxy';
import { SqliteD1 } from './search-sqlite-d1';

function memoryKv() {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key: string) => data.get(key) ?? null,
    put: async (key: string, value: string) => void data.set(key, value),
    delete: async (key: string) => void data.delete(key),
  };
}

const realFetch = globalThis.fetch;
const realNow = Date.now;
const MB = 1024 * 1024;
/** 5 s into an hour, so advancing a few minutes stays in the same hour and day */
const START = Date.UTC(2026, 10, 9, 10, 0, 5);
let clock = START;
const advance = (seconds: number) => void (clock += seconds * 1000);

/** A small tier so limits are reached in a few requests */
const SMALL = { name: 'Small', perHour: 20, perDay: 50, maxConcurrent: 5, maxChannels: 2 };
const SMALL_LIMITS = sessionLimitsOf({ ...SMALL, id: 'small', unlimited: false, updatedAt: null, updatedBy: null });

interface Options {
  env?: Record<string, unknown>;
  /** user -> tier id assigned before the test (default: alice, bob, mallory hold 'small') */
  tiers?: Record<string, string>;
  /** channel id -> owner, for the channelOwnerId the real channelIdMiddleware sets */
  channels?: Record<string, string>;
  /** false: the channel stand-in does not index ownership (the queue has not run yet) */
  indexChannels?: boolean;
  /** What the initiate stand-in answers (default: a new video) */
  initiateAnswer?: () => { status: number; body: unknown };
}

async function harness(opts: Options = {}) {
  const db = new SqliteD1();
  const d1 = db as unknown as D1Database;
  await saveTier(d1, 'small', SMALL, 'test', { create: true });
  for (const [user, tier] of Object.entries(opts.tiers ?? { alice: 'small', bob: 'small', mallory: 'small' })) {
    await assignTier(d1, user, tier, 'test');
  }
  const tusKv = memoryKv();
  const created: string[] = [];
  const app = new Hono();
  // Stand-ins for authMiddleware and channelIdMiddleware
  app.use('*', async (c, next) => {
    const user = c.req.header('x-test-user');
    if (user) {
      c.set('userId' as never, user as never);
      const roles = c.req.header('x-test-roles')?.split(',');
      c.set('auth' as never, { userId: user, payload: { sub: user, roles } } as never);
    }
    const channelId = c.req.header('channelId');
    if (channelId && opts.channels?.[channelId]) c.set('channelOwnerId' as never, opts.channels[channelId] as never);
    await next();
  });
  const limiter = uploadSessionLimitMiddleware();
  for (const path of UPLOAD_SESSION_PATHS) app.use(path, limiter);
  const continueLimiter = uploadContinueLimitMiddleware();
  for (const path of UPLOAD_CONTINUE_PATHS) app.use(path, continueLimiter);
  app.use('/api/channels', channelCreateGate);
  // Stand-in for ChannelCreate. The real one indexes ownership from the queue
  // (later); indexChannels: false leaves the index behind, x-test-fail fails it.
  const channelsCreated: string[] = [];
  app.post('/api/channels', async (c) => {
    if (c.req.header('x-test-fail')) return c.json({ success: false, error: 'boom' }, 500);
    // A tick between the gate and the store, where a parallel create could slip in
    await new Promise((r) => setTimeout(r, 5));
    const id = `ch-${Math.random().toString(36).slice(2)}`;
    channelsCreated.push(id);
    if (opts.indexChannels !== false) {
      db.db.prepare("INSERT INTO content_ownership (kind, id, owner_id) VALUES ('channel', ?, ?)").run(id, c.get('userId' as never) as string);
    }
    return c.json({ success: true, result: { channel: { id } } });
  });
  // Stand-ins for the direct video create, live stream create and the video list
  app.post('/api/videos', (c) => c.json({ success: true }));
  app.post('/api/live-streams', (c) => c.json({ success: true }));
  app.get('/api/videos', (c) => c.json({ success: true }));
  const indexChannel = (id: string, owner: string) =>
    db.db.prepare("INSERT INTO content_ownership (kind, id, owner_id) VALUES ('channel', ?, ?)").run(id, owner);
  const deleteChannel = (id: string) => db.db.prepare("UPDATE content_ownership SET is_deleted = 1 WHERE kind = 'channel' AND id = ?").run(id);
  // Stand-ins for the initiate handlers: each records the video it would create
  app.post('/api/videos/upload/initiate', (c) => {
    if (opts.initiateAnswer) {
      const answer = opts.initiateAnswer();
      return c.json(answer.body as object, answer.status as 200);
    }
    created.push(`video-${created.length + 1}`);
    return c.json({ success: true, result: { videoId: `video-${created.length}` } });
  });
  app.post('/api/videos/upload/batch/initiate', async (c) => {
    const { videos } = (await c.req.json()) as { videos: unknown[] };
    const allowance = c.get('uploadAllowance' as never) as { allowed: number; retryAfter: number } | undefined;
    const started = allowance ? videos.slice(0, allowance.allowed) : videos;
    for (const _ of started) created.push(`video-${created.length + 1}`);
    return c.json({
      success: true,
      result: started.map((_, i) => ({ videoId: `b-${i}` })),
      ...(started.length < videos.length ? { deferred: { count: videos.length - started.length, retryAfter: allowance?.retryAfter } } : {}),
    });
  });
  app.post('/api/videos/upload/complete', (c) => c.json({ success: true }));
  app.route('/api/videos/tus', createTusRouter());

  const fullEnv = {
    UPLOAD_RATE_LIMIT: 'on',
    ...opts.env,
    SEARCH_DB: db,
    TUS_SESSIONS: tusKv,
    'bunny-stream-key': 'test-key',
    bunny_stream_library_id: '123',
  };
  const request = (user: string, path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { 'x-test-user': user, ...(init.headers as Record<string, string>) } }, fullEnv);
  const json = { 'content-type': 'application/json' };
  const initiate = (user: string, headers: Record<string, string> = {}) =>
    request(user, '/api/videos/upload/initiate', { method: 'POST', body: '{}', headers: { ...json, ...headers } });
  const batch = (user: string, count: number, headers: Record<string, string> = {}) =>
    request(user, '/api/videos/upload/batch/initiate', {
      method: 'POST',
      body: JSON.stringify({ videos: Array.from({ length: count }, (_, i) => ({ title: `v${i}` })) }),
      headers: { ...json, ...headers },
    });
  const chunk = (user: string, uploadId: string, offset: number) =>
    request(user, `/api/videos/tus/${uploadId}`, {
      method: 'PATCH',
      body: new Uint8Array(16),
      headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': String(offset), 'tus-resumable': '1.0.0' },
    });
  const startUpload = (user: string, uploadId: string, fileSize = 2048 * MB) =>
    tusKv.put(
      `tus:upload:${uploadId}`,
      JSON.stringify({ uploadId, userId: user, videoId: `vid-${uploadId}`, fileSize, uploadOffset: 0, bunnyUploadUrl: `https://bunny.test/tus/${uploadId}` }),
    );
  const tusCreate = (user: string, headers: Record<string, string> = {}) =>
    request(user, '/api/videos/tus', { method: 'POST', headers: { 'tus-resumable': '1.0.0', 'upload-length': '10', ...headers } });
  const complete = (user: string) => request(user, '/api/videos/upload/complete', { method: 'POST', body: '{}', headers: json });
  const createChannel = (user: string, headers: Record<string, string> = {}) =>
    request(user, '/api/channels', { method: 'POST', body: '{"name":"x"}', headers: { ...json, ...headers } });
  const hour = (user: string) =>
    Number(
      (db.db.prepare("SELECT count FROM upload_rate_windows WHERE user_id = ? AND operation = ? AND period = 'hour'").get(user, UPLOAD_SESSION_OPERATION) as
        | { count: number }
        | undefined)?.count ?? 0,
    );
  return { db, d1, request, initiate, batch, chunk, startUpload, tusCreate, complete, createChannel, created, hour, channelsCreated, indexChannel, deleteChannel };
}

describe('creator tiers: who may upload', () => {
  let bunnyPatches = 0;
  beforeEach(() => {
    clock = START;
    Date.now = () => clock;
    bunnyPatches = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('https://bunny.test/') && init?.method === 'PATCH') {
        bunnyPatches++;
        const offset = Number((init.headers as Record<string, string>)['Upload-Offset'] ?? 0) + 5 * MB;
        return new Response(null, { status: 204, headers: { 'Upload-Offset': String(offset) } });
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  });

  it('a user with no tier cannot initiate, batch, TUS-create or complete: 403 uploads_by_invitation, nothing created or counted', async () => {
    const h = await harness();
    for (const res of [await h.initiate('nobody'), await h.batch('nobody', 3), await h.tusCreate('nobody'), await h.complete('nobody'),
      await h.request('nobody', '/api/videos/upload', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })]) {
      assert.equal(res.status, 403);
      const body = (await res.json()) as { code: string; error: string };
      assert.equal(body.code, CREATOR_ERROR_CODES.uploadsByInvitation);
      assert.equal(body.error, UPLOADS_BY_INVITATION_MESSAGE);
    }
    assert.equal(h.created.length, 0);
    assert.equal(h.db.count('upload_rate_windows'), 0);
    // The tier gate applies even where limits are not counted (development, "off")
    const dev = await harness({ env: { UPLOAD_RATE_LIMIT: 'off' } });
    assert.equal((await dev.initiate('nobody')).status, 403);
    assert.equal((await dev.initiate('alice')).status, 200);
  });

  it('assigning a tier lets the user upload at once; removing it blocks the next request (no re-sign-in)', async () => {
    const h = await harness();
    assert.equal((await h.initiate('carol')).status, 403);
    await assignTier(h.d1, 'carol', 'creator', 'admin-1');
    assert.equal((await h.initiate('carol')).status, 200);
    await assignTier(h.d1, 'carol', null, 'admin-1');
    assert.equal((await h.initiate('carol')).status, 403);
    assert.equal((await h.tusCreate('carol')).status, 403, 'an upload in progress cannot start its TUS upload after revocation');
  });

  it('counts an upload of many chunks once', async () => {
    const h = await harness();
    assert.equal((await h.initiate('alice')).status, 200);
    await h.startUpload('alice', 'up-1');
    const chunks = SMALL.perHour + 5;
    for (let i = 0; i < chunks; i++) assert.equal((await h.chunk('alice', 'up-1', i * 5 * MB)).status, 204, `chunk ${i}`);
    assert.equal(bunnyPatches, chunks);
    const next = await h.initiate('alice');
    assert.equal(next.status, 200);
    assert.equal(next.headers.get('X-RateLimit-Remaining-Hour'), String(SMALL.perHour - 2));
  });

  it('past the tier\'s hourly limit: a friendly 429 upload_limit with retryAfter, a warning record for the admin, no video', async () => {
    const h = await harness();
    for (let i = 0; i < SMALL.perHour; i++) assert.equal((await h.initiate('alice')).status, 200);
    const refused = await h.initiate('alice');
    assert.equal(refused.status, 429);
    const body = (await refused.json()) as { code: string; error: string; retryAfter: number; retryAt: string; limitExceeded: string; limit: number };
    assert.equal(body.code, CREATOR_ERROR_CODES.uploadLimit);
    assert.doesNotMatch(body.error, /Rate limit exceeded/);
    assert.equal(body.limitExceeded, 'hour');
    assert.equal(body.limit, SMALL.perHour);
    assert.equal(body.retryAfter, 3600 - 5, 'until the hour ends');
    assert.equal(Number(refused.headers.get('Retry-After')), body.retryAfter);
    assert.equal(new Date(body.retryAt).getTime(), clock + body.retryAfter * 1000);
    assert.equal(h.created.length, SMALL.perHour);
    const hits = h.db.db.prepare('SELECT user_id, period, tier_id FROM upload_limit_hits').all() as Array<Record<string, string>>;
    assert.deepEqual(hits.map((r) => ({ ...r })), [{ user_id: 'alice', period: 'hour', tier_id: 'small' }]);
    assert.equal((await h.initiate('bob')).status, 200, 'per user');
  });

  it('retries never count: an initiate that reuses an unfinished upload (reused: true) is refunded', async () => {
    let reused = false;
    const h = await harness({ initiateAnswer: () => ({ status: 200, body: { success: true, result: { videoId: 'same', reused } } }) });
    assert.equal((await h.initiate('alice')).status, 200);
    assert.equal(h.hour('alice'), 1);
    reused = true;
    for (let i = 0; i < SMALL.perHour * 3; i++) assert.equal((await h.initiate('alice')).status, 200, `retry ${i}`);
    assert.equal(h.hour('alice'), 1, 'only the first initiate counted');
  });

  it('a failed initiate gives its sessions back', async () => {
    const h = await harness({ initiateAnswer: () => ({ status: 500, body: { success: false, error: 'Bunny down' } }) });
    for (let i = 0; i < SMALL.perHour + 5; i++) assert.equal((await h.initiate('alice')).status, 500);
    assert.equal(h.hour('alice'), 0);
  });

  it('an upload flagged failed or abandoned gives its session back to the tier holder', async () => {
    const h = await harness();
    for (let i = 0; i < SMALL.perHour; i++) await h.initiate('alice');
    assert.equal((await h.initiate('alice')).status, 429);
    await refundUploadSession(h.d1, 'alice', new Date(clock - 1000).toISOString());
    assert.equal(h.hour('alice'), SMALL.perHour - 1);
    assert.equal((await h.initiate('alice')).status, 200);
    // An upload started in an earlier hour refunds nothing in this one
    await refundUploadSession(h.d1, 'alice', new Date(clock - 2 * 3600_000).toISOString());
    assert.equal(h.hour('alice'), SMALL.perHour);
  });

  it('countReused finds reused entries in single and batch answers', () => {
    assert.equal(countReused({ success: true, result: { videoId: 'a', reused: true } }), 1);
    assert.equal(countReused({ success: true, result: [{ reused: true }, { reused: false }, { reused: true }] }), 2);
    assert.equal(countReused({ success: true, result: { videoId: 'a' } }), 0);
    assert.equal(countReused(null), 0);
  });

  it('a batch that would cross the limit starts as many as fit and defers the rest, with when', async () => {
    const h = await harness();
    for (let i = 0; i < SMALL.perHour - 4; i++) await h.initiate('alice');
    const res = await h.batch('alice', 11);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { result: unknown[]; deferred: { count: number; retryAfter: number } };
    assert.equal(body.result.length, 4);
    assert.equal(body.deferred.count, 7);
    assert.equal(body.deferred.retryAfter, 3600 - 5);
    assert.equal(h.hour('alice'), SMALL.perHour);
    // Full now: the next batch is refused whole, with the friendly answer
    const full = await h.batch('alice', 3);
    assert.equal(full.status, 429);
    assert.equal(((await full.json()) as { code: string }).code, CREATOR_ERROR_CODES.uploadLimit);
  });

  it('a batch that fits starts whole and counts once per video', async () => {
    const h = await harness();
    const res = await h.batch('alice', MAX_BATCH_SIZE);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { deferred?: unknown }).deferred, undefined);
    assert.equal(res.headers.get('X-RateLimit-Remaining-Hour'), String(SMALL.perHour - MAX_BATCH_SIZE));
  });

  it('the shipped Creator tier allows 300 an hour, 2,000 a day, 20 at once', async () => {
    const h = await harness({ tiers: { dana: 'creator' } });
    const res = await h.batch('dana', 15);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-RateLimit-Remaining-Hour'), String(300 - 15));
    assert.equal(res.headers.get('X-RateLimit-Remaining-Day'), String(2000 - 15));
    assert.deepEqual(sessionLimitsOf((await readTier(h.d1, 'creator'))!), { perMinute: 300, perHour: 300, perDay: 2000, maxConcurrent: 20 });
  });

  it('super admins are unlimited without a tier: a batch of 15 after 1,000 uploads in the hour still passes', async () => {
    const h = await harness();
    const owner = 'usr_owner';
    const superAdmin = { 'x-test-roles': 'Super Admin' };
    for (let i = 0; i < 1000; i++) assert.equal((await h.initiate(owner, superAdmin)).status, 200, `upload ${i + 1}`);
    // Even counters far past every limit do not apply to them
    const now = Math.floor(clock / 1000);
    for (const [period, len] of [['minute', 60], ['hour', 3600], ['day', 86400]] as const) {
      h.db.db
        .prepare('INSERT OR REPLACE INTO upload_rate_windows (user_id, operation, period, window_start, count) VALUES (?, ?, ?, ?, ?)')
        .run(owner, UPLOAD_SESSION_OPERATION, period, now - (now % len), 1000);
    }
    const res = await h.batch(owner, 15, superAdmin);
    assert.equal(res.status, 200);
    assert.equal(h.created.length, 1015);
    const parallel = await Promise.all(Array.from({ length: 40 }, () => h.initiate(owner, superAdmin)));
    assert.deepEqual([...new Set(parallel.map((r) => r.status))], [200], 'no concurrency limit');
    for (let i = 0; i < 100; i++) assert.notEqual((await h.tusCreate(owner, superAdmin)).status, 429);
    assert.equal(h.db.count('upload_rate_leases'), 0);
  });

  it('the Unlimited tier lifts every limit; plain admins without a tier are blocked like anyone', async () => {
    const h = await harness({ tiers: { erin: 'unlimited' } });
    for (let i = 0; i < 200; i++) assert.equal((await h.initiate('erin')).status, 200);
    assert.equal(h.hour('erin'), 0, 'nothing counted');
    assert.equal((await h.initiate('admin-user', { 'x-test-roles': 'Admin' })).status, 403);
  });

  it('managers and editors upload to a tiered owner\'s channel under the owner\'s tier and limits', async () => {
    const h = await harness({ tiers: { owner: 'small' }, channels: { 'ch-1': 'owner' } });
    // The member has no tier of their own
    assert.equal((await h.initiate('member')).status, 403);
    assert.equal((await h.initiate('member', { channelId: 'ch-1' })).status, 200);
    assert.equal(h.hour('owner'), 1, 'counted against the owner');
    assert.equal(h.hour('member'), 0);
    // An untiered owner's channel gives members nothing
    const untiered = await harness({ tiers: {}, channels: { 'ch-2': 'someone' } });
    assert.equal((await untiered.initiate('member', { channelId: 'ch-2' })).status, 403);
  });

  it('a D1 failure on the tier lookup refuses (503), never lets the upload through', async () => {
    const broken = { prepare: () => { throw new Error('D1 unavailable'); }, batch: async () => { throw new Error('D1 unavailable'); } };
    const app = new Hono();
    app.use('*', async (c, next) => (c.set('userId' as never, 'alice' as never), next()));
    let handled = 0;
    app.use('/api/videos/upload/initiate', uploadSessionLimitMiddleware());
    app.post('/api/videos/upload/initiate', (c) => (handled++, c.json({ ok: true })));
    const res = await app.request('/api/videos/upload/initiate', { method: 'POST' }, { UPLOAD_RATE_LIMIT: 'on', SEARCH_DB: broken });
    assert.equal(res.status, 503);
    assert.equal(handled, 0);
  });

  it('does not gate or count GET or OPTIONS', async () => {
    const h = await harness();
    await h.request('nobody', '/api/videos/upload/initiate', { method: 'OPTIONS' });
    assert.notEqual((await h.request('nobody', '/api/videos/upload', { method: 'GET' })).status, 403);
    assert.equal(h.db.count('upload_rate_windows'), 0);
  });

  it('TUS create and complete have their own looser bucket, without touching the session quota', async () => {
    const h = await harness();
    const { perMinute } = continueLimitsOf({ ...SMALL, id: 'small', unlimited: false, updatedAt: null, updatedBy: null });
    const statuses: number[] = [];
    for (let i = 0; i < perMinute + 1; i++) statuses.push((await h.tusCreate('alice')).status);
    assert.deepEqual(statuses.slice(0, perMinute), Array(perMinute).fill(400), 'no metadata: the proxy answers 400, still counted');
    assert.equal(statuses[perMinute], 429);
    const next = await h.initiate('alice');
    assert.equal(next.headers.get('X-RateLimit-Remaining-Hour'), String(SMALL.perHour - 1));
  });

  it('rejects a chunk for an unknown upload id or for another user\'s upload, without forwarding it', async () => {
    const h = await harness();
    await h.startUpload('alice', 'up-alice');
    assert.equal((await h.chunk('mallory', 'does-not-exist', 0)).status, 404);
    assert.equal((await h.chunk('mallory', 'up-alice', 0)).status, 403);
    assert.equal(bunnyPatches, 0);
    assert.equal((await h.request('mallory', '/api/videos/tus/up-alice', { method: 'HEAD' })).status, 403);
  });

  it('50 parallel initiations: only the tier\'s maxConcurrent get in at once', async () => {
    const h = await harness();
    const responses = await Promise.all(Array.from({ length: 50 }, () => h.initiate('alice')));
    assert.equal(responses.filter((r) => r.status === 200).length, SMALL_LIMITS.maxConcurrent);
    assert.equal(h.created.length, SMALL_LIMITS.maxConcurrent);
    assert.equal(h.db.count('upload_rate_leases'), 0);
  });

  it('counts limits in production, stage and QA; not where the env opts out', () => {
    assert.equal(uploadLimitsEnforced({ ENVIRONMENT: 'production' }), true);
    assert.equal(uploadLimitsEnforced({ ENVIRONMENT: 'stage' }), true);
    assert.equal(uploadLimitsEnforced({ UPLOAD_RATE_LIMIT: 'on', ENVIRONMENT: 'qa' }), true);
    assert.equal(uploadLimitsEnforced({ ENVIRONMENT: 'preview' }), false);
    assert.equal(uploadLimitsEnforced({}), false);
    assert.equal(uploadLimitsEnforced({ UPLOAD_RATE_LIMIT: 'off', ENVIRONMENT: 'production' }), false);
  });

  it('index.ts gates every session route, TUS create and complete, never chunks or resume', () => {
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    assert.match(index, /for \(const path of UPLOAD_SESSION_PATHS\) app\.use\(path, uploadSessionLimit\)/);
    assert.match(index, /for \(const path of UPLOAD_CONTINUE_PATHS\) app\.use\(path, uploadContinueLimit\)/);
    assert.match(index, /app\.use\('\/api\/channels', channelCreateGate\)/);
    assert.ok(!(UPLOAD_CONTINUE_PATHS as readonly string[]).some((p) => p.includes('*')), 'chunks (/tus/*) are never gated per request');
    assert.ok(!(UPLOAD_SESSION_PATHS as readonly string[]).some((p) => p.includes('resume')));
  });
});

describe('creator tiers: channels, access and admin', () => {
  beforeEach(() => {
    clock = START;
    Date.now = () => clock;
  });
  afterEach(() => {
    Date.now = realNow;
  });

  it('no tier: channel create answers 403 uploads_by_invitation; a tier allows up to its channel limit', async () => {
    const h = await harness();
    const none = await h.createChannel('nobody');
    assert.equal(none.status, 403);
    assert.equal(((await none.json()) as { code: string }).code, CREATOR_ERROR_CODES.uploadsByInvitation);
    assert.equal((await h.createChannel('alice')).status, 200);
    assert.equal((await h.createChannel('alice')).status, 200);
    const third = await h.createChannel('alice');
    assert.equal(third.status, 403);
    const body = (await third.json()) as { code: string; maxChannels: number; channelsOwned: number };
    assert.deepEqual([body.code, body.maxChannels, body.channelsOwned], [CREATOR_ERROR_CODES.channelLimit, SMALL.maxChannels, 2]);
    // Unlimited and super admins have no channel limit
    await assignTier(h.d1, 'alice', 'unlimited', 'admin');
    assert.equal((await h.createChannel('alice')).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await h.createChannel('owner', { 'x-test-roles': 'Super Admin' })).status, 200);
  });

  it('channel limit holds for parallel creates and before the ownership index catches up', async () => {
    const h = await harness({ indexChannels: false });
    const answers = await Promise.all(Array.from({ length: 6 }, () => h.createChannel('alice')));
    assert.deepEqual(answers.map((r) => r.status).sort(), [200, 200, 403, 403, 403, 403], 'only the tier\'s 2 slots are taken');
    // Sequential, index still behind: still full
    assert.equal((await h.createChannel('alice')).status, 403);
    // Indexed: counted once (the reservation stops counting), still full
    for (const id of h.channelsCreated) h.indexChannel(id, 'alice');
    const full = await h.createChannel('alice');
    assert.equal(full.status, 403);
    assert.equal(((await full.json()) as { channelsOwned: number }).channelsOwned, 2);
    // A deleted channel frees its slot
    h.deleteChannel(h.channelsCreated[0]);
    assert.equal((await h.createChannel('alice')).status, 200);
  });

  it('a failed channel create gives its slot back', async () => {
    const h = await harness({ indexChannels: false });
    for (let i = 0; i < 3; i++) assert.equal((await h.createChannel('alice', { 'x-test-fail': '1' })).status, 500);
    assert.equal((await h.createChannel('alice')).status, 200);
    assert.equal((await h.createChannel('alice')).status, 200);
    assert.equal((await h.createChannel('alice')).status, 403);
  });

  it('direct video create (POST /api/videos) and live stream create need a tier and count as sessions', async () => {
    const h = await harness();
    for (const path of ['/api/videos', '/api/live-streams']) {
      const res = await h.request('nobody', path, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
      assert.equal(res.status, 403, path);
      assert.equal(((await res.json()) as { code: string }).code, CREATOR_ERROR_CODES.uploadsByInvitation);
      assert.equal((await h.request('alice', path, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 200, path);
    }
    assert.equal(h.hour('alice'), 2);
    // Listing videos is not gated
    assert.equal((await h.request('nobody', '/api/videos')).status, 200);
  });

  it('client-reported failures are refunded up to a daily cap; failures the sweep finds always are', async () => {
    const h = await harness();
    for (let i = 0; i < SMALL.perHour; i++) await h.initiate('alice');
    const started = new Date(clock - 1000).toISOString();
    let refunded = 0;
    for (let i = 0; i < CLIENT_REFUNDS_PER_DAY + 5; i++) {
      if (await refundUploadSession(h.d1, 'alice', started, { source: 'client', nowMs: clock })) refunded++;
    }
    assert.equal(refunded, CLIENT_REFUNDS_PER_DAY);
    assert.equal(await refundUploadSession(h.d1, 'alice', started, { source: 'sweep', nowMs: clock }), true);
    // The next day the client allowance starts over
    assert.equal(await refundUploadSession(h.d1, 'alice', started, { source: 'client', nowMs: clock + 86_400_000 }), true);
  });

  it('GET /api/me/creator says what the user may do', async () => {
    const h = await harness();
    const none = await creatorAccess(h.d1, 'nobody', []);
    assert.deepEqual([none.canUpload, none.canCreateChannel, none.tier, none.via], [false, false, null, 'none']);
    await h.initiate('alice');
    const alice = await creatorAccess(h.d1, 'alice', []);
    assert.deepEqual([alice.canUpload, alice.canCreateChannel, alice.tier?.id, alice.maxChannels], [true, true, 'small', SMALL.maxChannels]);
    assert.deepEqual(alice.usage, { hour: 1, day: 1 });
    assert.deepEqual(alice.limits, { perHour: 20, perDay: 50, maxConcurrent: 5 });
    const owner = await creatorAccess(h.d1, 'owner', ['Super Admin']);
    assert.deepEqual([owner.via, owner.tier?.unlimited, owner.limits, owner.maxChannels], ['super_admin', true, null, null]);
  });

  it('tier definitions fall back to the shipped defaults, validate, and cannot be deleted while held', async () => {
    const h = await harness();
    h.db.db.exec("DELETE FROM creator_tiers WHERE id IN ('creator', 'unlimited')");
    const fallback = await readTiers(h.d1);
    assert.equal(fallback.find((t) => t.id === 'creator')?.perHour, DEFAULT_CREATOR_TIER.perHour);
    assert.equal(fallback.find((t) => t.id === 'unlimited')?.unlimited, true);
    // D1 down: still the defaults
    const down = await readTiers({ prepare: () => { throw new Error('down'); } } as unknown as D1Database);
    assert.deepEqual(down.map((t) => t.id).sort(), ['creator', 'unlimited']);

    await saveTier(h.d1, 'creator', { perHour: 500 }, 'admin-1');
    assert.equal((await readTier(h.d1, 'creator'))?.perHour, 500);
    assert.equal((await readTier(h.d1, 'creator'))?.perDay, DEFAULT_CREATOR_TIER.perDay, 'unchanged fields keep their value');
    assert.throws(() => validateTier('x1', { name: 'X', perHour: 0, perDay: 1, maxConcurrent: 1 }), /perHour/);
    assert.throws(() => validateTier('x1', { name: 'X', perHour: 10, perDay: 5, maxConcurrent: 1 }), /perDay/);
    assert.equal(validateTier('unlimited', { name: 'U', unlimited: false }).unlimited, true, 'Unlimited stays unlimited');
    await assert.rejects(deleteTier(h.d1, 'small'), /hold this tier/);
    await assert.rejects(deleteTier(h.d1, 'creator'), /cannot be deleted/);
    await assert.rejects(assignTier(h.d1, 'zed', 'missing', 'admin'), /tier_not_found/);
  });

  it('records the assignment source so subscriptions can grant tiers later', async () => {
    const h = await harness();
    const { assignment, previous } = await assignTier(h.d1, 'alice', 'creator', 'billing', 'subscription');
    assert.equal(previous?.tierId, 'small');
    assert.equal(assignment?.source, 'subscription');
    const resolved = await resolveCreator(h.d1, { userId: 'alice' });
    assert.equal(resolved.tier?.id, 'creator');
  });

  it('the Creators list shows every videos user, flags users with content but no tier (Needs tier), with usage and limit hits', async () => {
    const h = await harness({ tiers: { alice: 'small' } });
    const add = (kind: string, id: string, owner: string) =>
      h.db.db.prepare('INSERT INTO content_ownership (kind, id, owner_id) VALUES (?, ?, ?)').run(kind, id, owner);
    add('channel', 'ch-migrated', 'usr_migrated');
    add('video', 'v-migrated', 'usr_migrated');
    add('video', 'v-alice', 'alice');
    add('profile', 'usr_viewer', 'usr_viewer');
    for (let i = 0; i < SMALL.perHour + 1; i++) await h.initiate('alice');
    const profiles = { get: async () => null } as unknown as R2Bucket;
    const page = await listCreators({ SEARCH_DB: h.d1, profiles }, {});
    const byId = new Map(page.items.map((r) => [r.userId, r]));
    assert.equal(byId.get('usr_viewer')?.needsTier, false, 'every videos user is listed; a viewer without content does not need a tier');
    assert.equal(byId.get('usr_migrated')?.needsTier, true);
    assert.equal(byId.get('usr_migrated')?.channels, 1);
    assert.equal(byId.get('alice')?.needsTier, false);
    assert.equal(byId.get('alice')?.tierName, 'Small');
    assert.deepEqual(byId.get('alice')?.usage, { hour: SMALL.perHour, day: SMALL.perHour });
    assert.equal(byId.get('alice')?.limitHits7d, 1);
    assert.equal(page.items[0].userId, 'usr_migrated', 'Needs tier first');
    assert.equal(page.needsTier, 1);
    assert.equal(page.limitHits24h, 1);
    assert.equal(page.limitHits7d, 1);
    const needs = await listCreators({ SEARCH_DB: h.d1, profiles }, { filter: 'needs_tier' });
    assert.deepEqual(needs.items.map((r) => r.userId), ['usr_migrated']);
  });
});
