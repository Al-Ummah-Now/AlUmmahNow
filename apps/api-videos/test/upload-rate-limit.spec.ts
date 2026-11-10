/**
 * The D1 limiter itself (SCALABILITY-AUDIT AV-14): checks and counts in one
 * transaction, so parallel requests cannot all pass, leaked leases expire, an
 * outage refuses instead of letting everything through, and refunds give
 * units back. Who is limited and how much (creator tiers) is tested in
 * upload-limits.spec.ts.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  checkRateLimit,
  pruneRateLimits,
  RATE_LIMIT_LEASE_SECONDS,
  RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS,
  rateLimitMiddleware,
  refundRateLimit,
} from '../src/middleware/rate-limit';
import { uploadSessionLimitMiddleware } from '../src/middleware/upload-limits';
import { SqliteD1 } from './search-sqlite-d1';

const realNow = Date.now;
const START = Date.UTC(2026, 10, 9, 10, 0, 5);
let clock = START;

describe('D1 upload rate limiter (AV-14)', () => {
  beforeEach(() => {
    clock = START;
    Date.now = () => clock;
  });
  afterEach(() => {
    Date.now = realNow;
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
    const refusal = (await refused[0].json()) as { error: string; code: string; limitExceeded: string };
    assert.equal(refusal.code, 'upload_limit');
    assert.equal(refusal.limitExceeded, 'concurrent');
    assert.doesNotMatch(refusal.error, /Rate limit exceeded/);
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
    const res = await app.request('/api/videos/upload/initiate', { method: 'POST' }, { UPLOAD_RATE_LIMIT: 'on', SEARCH_DB: broken });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('Retry-After'), String(RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS));
    assert.equal(handled, 0, 'the upload is not started');
  });

  it('refunds give units back in the windows that still hold them, never below zero', async () => {
    const sqlite = new SqliteD1();
    const db = sqlite as unknown as D1Database;
    const limits = { perMinute: 3, perHour: 3, perDay: 3, maxConcurrent: 100 };
    for (let i = 0; i < 3; i++) assert.ok((await checkRateLimit(db, 'alice', 'op', limits, 1, clock)).allowed);
    assert.equal((await checkRateLimit(db, 'alice', 'op', limits, 1, clock)).limitExceeded, 'day', 'the window that frees up last');
    await refundRateLimit(db, 'alice', 'op', 2, clock);
    assert.ok((await checkRateLimit(db, 'alice', 'op', limits, 1, clock)).allowed);
    assert.ok((await checkRateLimit(db, 'alice', 'op', limits, 1, clock)).allowed);
    // Refunding more than was counted stops at zero
    await refundRateLimit(db, 'alice', 'op', 50, clock);
    const counts = sqlite.db.prepare("SELECT period, count FROM upload_rate_windows WHERE user_id = 'alice'").all() as { count: number }[];
    assert.ok(counts.every((r) => r.count === 0), JSON.stringify(counts));
    // A refund for a window that has ended changes the current one not at all
    assert.ok((await checkRateLimit(db, 'alice', 'op', limits, 1, clock + 2 * 86400_000)).allowed);
    await refundRateLimit(db, 'alice', 'op', 1, clock);
    const day = sqlite.db.prepare("SELECT count FROM upload_rate_windows WHERE user_id = 'alice' AND period = 'day'").get() as { count: number };
    assert.equal(day.count, 1);
  });
});
