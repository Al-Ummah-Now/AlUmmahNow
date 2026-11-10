/**
 * Upload rate limiting (#290): new upload SESSIONS are limited, the chunks of an
 * initiated upload are not. Runs the real limiter (as mounted in index.ts) and
 * the real TUS proxy router against D1 (node:sqlite, the search migrations),
 * in-memory KV for TUS sessions and a stubbed Bunny.
 *
 * The limiter checks and counts in one D1 transaction (SCALABILITY-AUDIT
 * AV-14), so parallel requests cannot all pass and leaked leases expire.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import {
  checkRateLimit,
  pruneRateLimits,
  RATE_LIMIT_LEASE_SECONDS,
  RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
  rateLimitMiddleware,
  UPLOAD_CONTINUE_LIMITS,
  UPLOAD_CONTINUE_PATHS,
  UPLOAD_SESSION_LIMITS,
  UPLOAD_SESSION_PATHS,
  uploadContinueLimitMiddleware,
  uploadSessionLimitMiddleware,
  uploadSessionLimits,
} from '../src/middleware/rate-limit';
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
/** Test clock (Date.now): 5 s into an hour, so advancing a few minutes stays in the same hour and day */
const START = Date.UTC(2026, 10, 9, 10, 0, 5);
let clock = START;
const advance = (seconds: number) => void (clock += seconds * 1000);

function harness(env: Record<string, unknown> = { UPLOAD_RATE_LIMIT: 'standard' }) {
  const db = new SqliteD1();
  const tusKv = memoryKv();
  const created: string[] = [];
  const app = new Hono();
  // Stand-in for authMiddleware: the user id the real one takes from the token
  app.use('*', async (c, next) => {
    const user = c.req.header('x-test-user');
    if (user) {
      c.set('userId' as never, user as never);
      c.set('auth' as never, { userId: user } as never);
    }
    await next();
  });
  const limiter = uploadSessionLimitMiddleware();
  for (const path of UPLOAD_SESSION_PATHS) app.use(path, limiter);
  const continueLimiter = uploadContinueLimitMiddleware();
  for (const path of UPLOAD_CONTINUE_PATHS) app.use(path, continueLimiter);
  // Stand-ins for the initiate handlers: each records the video it would create
  app.post('/api/videos/upload/initiate', (c) => {
    created.push(`video-${created.length + 1}`);
    return c.json({ success: true });
  });
  app.post('/api/videos/upload/batch/initiate', async (c) => {
    const { videos } = (await c.req.json()) as { videos: unknown[] };
    for (const _ of videos) created.push(`video-${created.length + 1}`);
    return c.json({ success: true });
  });
  app.route('/api/videos/tus', createTusRouter());

  const fullEnv = {
    ...env,
    SEARCH_DB: db,
    TUS_SESSIONS: tusKv,
    'bunny-stream-key': 'test-key',
    bunny_stream_library_id: '123',
  };
  const request = (user: string, path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { 'x-test-user': user, ...(init.headers as Record<string, string>) } }, fullEnv);
  const initiate = (user: string) =>
    request(user, '/api/videos/upload/initiate', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  const chunk = (user: string, uploadId: string, offset: number) =>
    request(user, `/api/videos/tus/${uploadId}`, {
      method: 'PATCH',
      body: new Uint8Array(16),
      headers: { 'content-type': 'application/offset+octet-stream', 'upload-offset': String(offset), 'tus-resumable': '1.0.0' },
    });
  /** The TUS upload session the proxy stores once an initiated upload starts */
  const startUpload = (user: string, uploadId: string, fileSize = 2048 * MB) =>
    tusKv.put(
      `tus:upload:${uploadId}`,
      JSON.stringify({ uploadId, userId: user, videoId: `vid-${uploadId}`, fileSize, uploadOffset: 0, bunnyUploadUrl: `https://bunny.test/tus/${uploadId}` }),
    );
  const tusCreate = (user: string) =>
    request(user, '/api/videos/tus', { method: 'POST', headers: { 'tus-resumable': '1.0.0', 'upload-length': '10' } });
  return { request, initiate, chunk, startUpload, tusCreate, created, db };
}

describe('upload rate limiting (#290)', () => {
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

  it('counts an upload of many chunks once', async () => {
    const h = harness();
    assert.equal((await h.initiate('alice')).status, 200);
    await h.startUpload('alice', 'up-1');
    // More chunks than the whole hourly quota: none of them is rate limited
    const chunks = UPLOAD_SESSION_LIMITS.standard.perHour + 5;
    for (let i = 0; i < chunks; i++) {
      const res = await h.chunk('alice', 'up-1', i * 5 * MB);
      assert.equal(res.status, 204, `chunk ${i} answered ${res.status}`);
    }
    assert.equal(bunnyPatches, chunks);
    const next = await h.initiate('alice');
    assert.equal(next.status, 200);
    assert.equal(next.headers.get('X-RateLimit-Remaining-Hour'), String(UPLOAD_SESSION_LIMITS.standard.perHour - 2));
  });

  it('refuses the initiation past the hourly limit with Retry-After and creates no video for it', async () => {
    const h = harness();
    const { perHour, perMinute } = UPLOAD_SESSION_LIMITS.standard;
    let allowed = 0;
    let refused: Response | undefined;
    // Spread over "minutes" so the per-minute limit is not what trips
    for (let i = 0; i < perHour + 1; i++) {
      if (i > 0 && i % perMinute === 0) advance(60);
      const res = await h.initiate('alice');
      if (res.status === 200) allowed++;
      else refused = res;
    }
    assert.equal(allowed, perHour);
    assert.ok(refused, `initiation ${perHour + 1} was not refused`);
    assert.equal(refused.status, 429);
    const retryAfter = Number(refused.headers.get('Retry-After'));
    assert.ok(retryAfter > 0 && retryAfter <= 3600, `Retry-After ${retryAfter}`);
    assert.equal(((await refused.json()) as { error: string }).error, 'Rate limit exceeded: hour');
    assert.equal(h.created.length, perHour, 'the refused initiation must not create a video record');
    // Another user is not affected
    assert.equal((await h.initiate('bob')).status, 200);
  });

  it('counts a batch initiate once per video', async () => {
    const h = harness();
    const batch = (n: number) =>
      h.request('alice', '/api/videos/upload/batch/initiate', {
        method: 'POST',
        body: JSON.stringify({ videos: Array.from({ length: n }, (_, i) => ({ title: `v${i}` })) }),
        headers: { 'content-type': 'application/json' },
      });
    const first = await batch(15);
    assert.equal(first.status, 200, 'a full batch of 15 fits a fresh hour');
    assert.equal(first.headers.get('X-RateLimit-Remaining-Hour'), String(UPLOAD_SESSION_LIMITS.standard.perHour - 15));
    // Minute window passes; 6 more would exceed the hour (15 + 6 > 20)
    advance(60);
    assert.equal((await batch(6)).status, 429);
    assert.equal(h.created.length, 15);
  });

  it('rejects a chunk for an unknown upload id or for another user\'s upload, without forwarding it', async () => {
    const h = harness();
    await h.startUpload('alice', 'up-alice');
    assert.equal((await h.chunk('mallory', 'does-not-exist', 0)).status, 404);
    assert.equal((await h.chunk('mallory', 'up-alice', 0)).status, 403);
    assert.equal(bunnyPatches, 0);
    // HEAD (resume) on someone else's upload is refused too
    assert.equal((await h.request('mallory', '/api/videos/tus/up-alice', { method: 'HEAD' })).status, 403);
  });

  it('enforces relaxed limits on QA and stage, none where the env opts out', async () => {
    assert.deepEqual(uploadSessionLimits({ UPLOAD_RATE_LIMIT: 'relaxed' }), UPLOAD_SESSION_LIMITS.relaxed);
    assert.deepEqual(uploadSessionLimits({ ENVIRONMENT: 'production' }), UPLOAD_SESSION_LIMITS.standard);
    assert.deepEqual(uploadSessionLimits({ ENVIRONMENT: 'stage' }), UPLOAD_SESSION_LIMITS.standard);
    assert.equal(uploadSessionLimits({ ENVIRONMENT: 'preview' }), null);
    assert.equal(uploadSessionLimits({}), null);
    assert.equal(uploadSessionLimits({ UPLOAD_RATE_LIMIT: 'off', ENVIRONMENT: 'production' }), null);
    assert.ok(UPLOAD_SESSION_LIMITS.relaxed.perHour > UPLOAD_SESSION_LIMITS.standard.perHour);

    const h = harness({ UPLOAD_RATE_LIMIT: 'relaxed' });
    const res = await h.initiate('alice');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-RateLimit-Remaining-Hour'), String(UPLOAD_SESSION_LIMITS.relaxed.perHour - 1));
  });

  it('does not count GET or OPTIONS on the upload routes', async () => {
    const h = harness();
    await h.request('alice', '/api/videos/upload/initiate', { method: 'OPTIONS' });
    await h.request('alice', '/api/videos/upload', { method: 'GET' });
    assert.equal(h.db.count('upload_rate_windows'), 0);
    assert.equal(h.db.count('upload_rate_leases'), 0);
  });

  it('index.ts mounts the limiter only on session routes, never on TUS, complete or resume', () => {
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const limited = [...index.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:rateLimitMiddleware|upload\w*Limit)/g)].map((m) => m[1]);
    for (const path of limited) {
      assert.ok(!/\/tus|\/upload\/complete|\/upload\/resume/.test(path), `${path} must not be rate limited per request`);
    }
    assert.match(index, /for \(const path of UPLOAD_SESSION_PATHS\) app\.use\(path, uploadSessionLimit\)/);
    assert.match(index, /for \(const path of UPLOAD_CONTINUE_PATHS\) app\.use\(path, uploadContinueLimit\)/);
    assert.ok(!(UPLOAD_CONTINUE_PATHS as readonly string[]).some((p) => p.includes('*')), 'chunks (/tus/*) are never in a bucket');
  });

  it('bounds TUS create replays in their own bucket, without touching the session quota', async () => {
    const h = harness();
    const { perMinute } = UPLOAD_CONTINUE_LIMITS.standard;
    const statuses: number[] = [];
    for (let i = 0; i < perMinute + 1; i++) statuses.push((await h.tusCreate('alice')).status);
    // No metadata: the proxy answers 400, but every create still counts toward the bucket
    assert.deepEqual(statuses.slice(0, perMinute), Array(perMinute).fill(400));
    assert.equal(statuses[perMinute], 429);
    const next = await h.initiate('alice');
    assert.equal(next.status, 200);
    assert.equal(next.headers.get('X-RateLimit-Remaining-Hour'), String(UPLOAD_SESSION_LIMITS.standard.perHour - 1));
  });
});

describe('upload rate limits under parallel requests (AV-14)', () => {
  beforeEach(() => {
    clock = START;
    Date.now = () => clock;
  });
  afterEach(() => {
    Date.now = realNow;
  });

  it('50 parallel initiations: only maxConcurrent are let in at once, the rest are refused and create nothing', async () => {
    const h = harness();
    const { maxConcurrent } = UPLOAD_SESSION_LIMITS.standard;
    const responses = await Promise.all(Array.from({ length: 50 }, () => h.initiate('alice')));
    const statuses = responses.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 200).length, maxConcurrent, statuses.join());
    const refused = responses.filter((r) => r.status === 429);
    assert.equal(refused.length, 50 - maxConcurrent);
    assert.ok(refused.every((r) => r.headers.get('X-RateLimit-Limit') === String(maxConcurrent)));
    assert.equal(h.created.length, maxConcurrent);
    const minute = h.db.db.prepare("SELECT count FROM upload_rate_windows WHERE user_id = 'alice' AND period = 'minute'").get() as { count: number };
    assert.equal(minute.count, maxConcurrent, 'refused requests are not counted');
    assert.equal(h.db.count('upload_rate_leases'), 0, 'every finished request released its lease');
  });

  it('50 parallel checks against a window: exactly the limit is counted', async () => {
    const sqlite = new SqliteD1();
    const db = sqlite as unknown as D1Database;
    const limits = { perMinute: 15, perHour: 20, perDay: 50, maxConcurrent: 1000 };
    const results = await Promise.all(Array.from({ length: 50 }, () => checkRateLimit(db, 'alice', 'op', limits, 1, clock)));
    assert.equal(results.filter((r) => r.allowed).length, 15);
    assert.ok(results.filter((r) => !r.allowed).every((r) => r.limitExceeded === 'minute'));
    assert.equal(sqlite.count('upload_rate_leases'), 15, 'only allowed requests hold a lease');
    // Next minute: the hour (20) caps it at 5 more, even with 50 at once
    const next = await Promise.all(Array.from({ length: 50 }, () => checkRateLimit(db, 'alice', 'op', limits, 1, clock + 60_000)));
    assert.equal(next.filter((r) => r.allowed).length, 5);
    assert.ok(next.filter((r) => !r.allowed).every((r) => r.limitExceeded === 'hour'));
  });

  it('parallel batch initiations are weighed together: no batch pushes the window past its limit', async () => {
    const h = harness();
    const batch = () =>
      h.request('alice', '/api/videos/upload/batch/initiate', {
        method: 'POST',
        body: JSON.stringify({ videos: Array.from({ length: 6 }, (_, i) => ({ title: `v${i}` })) }),
        headers: { 'content-type': 'application/json' },
      });
    const statuses = await Promise.all(Array.from({ length: 6 }, () => batch().then((r) => r.status)));
    // 15 per minute: two batches of 6 fit (12), a third would make 18
    assert.equal(statuses.filter((s) => s === 200).length, 2, statuses.join());
    assert.equal(h.created.length, 12);
  });

  it('holds at most maxConcurrent requests in flight, and frees the slots when they finish', async () => {
    const db = new SqliteD1();
    const limits = { perMinute: 100, perHour: 100, perDay: 100, maxConcurrent: 3 };
    let open = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    let inFlight = 0;
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userId' as never, 'alice' as never);
      await next();
    });
    app.use('/slow', rateLimitMiddleware('slow_op', { limits: () => limits }));
    app.post('/slow', async (c) => {
      inFlight++;
      await gate;
      return c.json({ ok: true });
    });
    const send = () => app.request('/slow', { method: 'POST' }, { SEARCH_DB: db });
    const pending = Array.from({ length: 10 }, send);
    // Three requests are inside the handler; give the other seven time to reach the limiter
    while (inFlight < 3) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 20));
    open();
    const responses = await Promise.all(pending);
    const refused = responses.filter((r) => r.status === 429);
    assert.equal(responses.filter((r) => r.status === 200).length, 3);
    assert.equal(refused.length, 7);
    assert.equal(((await refused[0].json()) as { error: string }).error, 'Rate limit exceeded: concurrent');
    assert.equal(db.count('upload_rate_leases'), 0);
    assert.equal((await send()).status, 200, 'finished requests free their slots');
  });

  it('a lease that is never released expires instead of locking the user out', async () => {
    const db = new SqliteD1() as unknown as D1Database;
    const limits = { perMinute: 100, perHour: 100, perDay: 100, maxConcurrent: 2 };
    // Two requests whose isolate died before releasing
    assert.ok((await checkRateLimit(db, 'alice', 'op', limits, 1, clock)).allowed);
    assert.ok((await checkRateLimit(db, 'alice', 'op', limits, 1, clock)).allowed);
    const blocked = await checkRateLimit(db, 'alice', 'op', limits, 1, clock + 60_000);
    assert.equal(blocked.limitExceeded, 'concurrent');
    const later = await checkRateLimit(db, 'alice', 'op', limits, 1, clock + (RATE_LIMIT_LEASE_SECONDS + 1) * 1000);
    assert.ok(later.allowed, 'the leaked leases expired');
  });

  it('a new minute starts over, while the hour keeps counting', async () => {
    const db = new SqliteD1() as unknown as D1Database;
    const limits = { perMinute: 2, perHour: 3, perDay: 100, maxConcurrent: 100 };
    assert.ok((await checkRateLimit(db, 'alice', 'op', limits, 1, clock)).allowed);
    assert.ok((await checkRateLimit(db, 'alice', 'op', limits, 1, clock)).allowed);
    const minute = await checkRateLimit(db, 'alice', 'op', limits, 1, clock);
    assert.equal(minute.limitExceeded, 'minute');
    assert.equal(minute.retryAfter, 55, 'until the fixed minute ends');
    assert.ok((await checkRateLimit(db, 'alice', 'op', limits, 1, clock + 60_000)).allowed);
    const hour = await checkRateLimit(db, 'alice', 'op', limits, 1, clock + 120_000);
    assert.equal(hour.limitExceeded, 'hour');
    assert.ok((await checkRateLimit(db, 'bob', 'op', limits, 1, clock + 120_000)).allowed, 'per user');
    assert.ok((await checkRateLimit(db, 'alice', 'other', limits, 1, clock + 120_000)).allowed, 'per operation');
  });

  it('prunes windows of users who stopped uploading and expired leases', async () => {
    const sqlite = new SqliteD1();
    const db = sqlite as unknown as D1Database;
    await checkRateLimit(db, 'old', 'op', undefined, 1, clock);
    await checkRateLimit(db, 'recent', 'op', undefined, 1, clock + 2 * 86400_000);
    await pruneRateLimits(db, clock + 3 * 86400_000);
    const users = (sqlite.db.prepare('SELECT DISTINCT user_id FROM upload_rate_windows').all() as { user_id: string }[]).map((r) => r.user_id);
    assert.deepEqual(users, ['recent']);
    assert.equal(sqlite.count('upload_rate_leases'), 0);
  });

  it('refuses the request (503, not counted) when D1 itself fails: an outage is never a bypass', async () => {
    const broken = { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error('D1 unavailable'); } } as unknown as D1Database;
    const result = await checkRateLimit(broken, 'alice', 'op', undefined, 1, clock);
    assert.equal(result.allowed, false);
    assert.equal(result.unavailable, true);
    assert.equal(result.leaseId, undefined);

    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userId' as never, 'alice' as never);
      await next();
    });
    let handled = 0;
    app.use('/api/videos/upload/initiate', uploadSessionLimitMiddleware());
    app.post('/api/videos/upload/initiate', (c) => (handled++, c.json({ ok: true })));
    const res = await app.request('/api/videos/upload/initiate', { method: 'POST' }, { UPLOAD_RATE_LIMIT: 'standard', SEARCH_DB: broken });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('Retry-After'), String(RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS));
    assert.equal(handled, 0, 'the upload is not started');
  });
});
