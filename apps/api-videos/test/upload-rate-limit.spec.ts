/**
 * Upload rate limiting (#290): new upload SESSIONS are limited, the chunks of an
 * initiated upload are not. Runs the real limiter (as mounted in index.ts) and
 * the real TUS proxy router against in-memory KV and a stubbed Bunny.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import {
  UPLOAD_SESSION_LIMITS,
  UPLOAD_SESSION_PATHS,
  uploadSessionLimitMiddleware,
  uploadSessionLimits,
} from '../src/middleware/rate-limit';
import { createTusRouter } from '../src/endpoints/video/tus/tusProxy';

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
const MB = 1024 * 1024;

function harness(env: Record<string, unknown> = { UPLOAD_RATE_LIMIT: 'standard' }) {
  const rateKv = memoryKv();
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
    RATE_LIMIT_KV: rateKv,
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
  return { request, initiate, chunk, startUpload, created, rateKv };
}

describe('upload rate limiting (#290)', () => {
  let bunnyPatches = 0;
  beforeEach(() => {
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
      if (i > 0 && i % perMinute === 0) {
        const key = [...h.rateKv.data.keys()][0];
        const state = JSON.parse(h.rateKv.data.get(key)!);
        state.lastReset.minute -= 61;
        h.rateKv.data.set(key, JSON.stringify(state));
      }
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
    const key = [...h.rateKv.data.keys()][0];
    const state = JSON.parse(h.rateKv.data.get(key)!);
    state.lastReset.minute -= 61;
    h.rateKv.data.set(key, JSON.stringify(state));
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
    assert.equal(h.rateKv.data.size, 0);
  });

  it('index.ts mounts the limiter only on session routes, never on TUS, complete or resume', () => {
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const limited = [...index.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:rateLimitMiddleware|uploadSessionLimit)/g)].map((m) => m[1]);
    for (const path of limited) {
      assert.ok(!/\/tus|\/upload\/complete|\/upload\/resume/.test(path), `${path} must not be rate limited`);
    }
    assert.match(index, /for \(const path of UPLOAD_SESSION_PATHS\) app\.use\(path, uploadSessionLimit\)/);
  });
});
