/**
 * Scheduler under concurrency and at volume (SCALABILITY-AUDIT SC-1..SC-4).
 *
 * The R2 fake honours onlyIf.etagMatches and yields with random latency on
 * every call, so the scheduler's publish and the owner's edits (written by
 * api-videos with the same kind of conditional write) interleave the way
 * they do across workers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageType, type ScheduledVideoMetadata } from '@al-ummah/shared-types';
import { buildScheduleKey, FAILED_PREFIX, listDueSchedules, markAsFailed, publishVideo } from '../src/publisher';
import { scheduleRetries } from '../src/retry';
import { dailyMetricsKey, recordRunMetrics } from '../src/monitoring';
import scheduler from '../src/index';

const pause = (ms = 3) => new Promise((r) => setTimeout(r, Math.random() * ms));

class FakeR2 {
  data = new Map<string, { body: string; etag: string; uploaded: Date }>();
  reads = 0;
  lists = 0;
  private n = 0;
  constructor(private latency = 3) {}
  set(key: string, value: unknown) {
    this.data.set(key, { body: JSON.stringify(value), etag: `e${++this.n}`, uploaded: new Date(1e12 + this.n) });
  }
  read(key: string) { const o = this.data.get(key); return o ? JSON.parse(o.body) : null; }
  async get(key: string) {
    await pause(this.latency);
    this.reads++;
    const o = this.data.get(key);
    return o ? { key, etag: o.etag, uploaded: o.uploaded, text: async () => o.body, json: async () => JSON.parse(o.body) } : null;
  }
  async put(key: string, body: string, opts?: { onlyIf?: { etagMatches?: string } }) {
    await pause(this.latency);
    const cur = this.data.get(key);
    if (opts?.onlyIf?.etagMatches !== undefined && opts.onlyIf.etagMatches !== cur?.etag) return null;
    const o = { body, etag: `e${++this.n}`, uploaded: new Date(1e12 + this.n) };
    this.data.set(key, o);
    return { key, etag: o.etag, uploaded: o.uploaded };
  }
  async delete(key: string) { await pause(this.latency); this.data.delete(key); }
  async list(opts: { limit?: number; cursor?: string; prefix?: string } = {}) {
    await pause(this.latency);
    this.lists++;
    const keys = [...this.data.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix)).sort();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = opts.limit ?? 1000;
    const page = keys.slice(start, start + limit);
    const truncated = start + limit < keys.length;
    return { objects: page.map((key) => ({ key })), truncated, ...(truncated ? { cursor: String(start + limit) } : {}) };
  }
}

/** api-videos writing the video with a conditional write, as its R2Repository.updateObject does */
async function ownerUpdate(bucket: FakeR2, id: string, mutate: (v: any) => boolean) {
  for (;;) {
    const o = await bucket.get(id);
    if (!o) return false;
    const v = JSON.parse(await o.text());
    if (!mutate(v)) return false;
    if (await bucket.put(id, JSON.stringify(v), { onlyIf: { etagMatches: o.etag } })) return true;
  }
}

const meta = (videoId: string, at: Date, extra: Partial<ScheduledVideoMetadata> = {}): ScheduledVideoMetadata => ({
  videoId, title: videoId, channelId: 'ch', userId: 'u', scheduledPublishDate: at.toISOString(), timezone: 'UTC',
  localScheduledDate: at.toISOString(), notifyOnPublish: false, retryCount: 0, ...extra,
});

describe('SC-1: publish is a conditional write', () => {
  it('200 races of publish vs owner cancel vs owner edits: never public after a cancel, no edit lost', async () => {
    const now = new Date('2026-11-09T12:00:00Z');
    let cancelledWins = 0;
    for (let round = 0; round < 200; round++) {
      const videos = new FakeR2(6);
      videos.set('v', { id: 'v', title: 'T', isPublic: false, scheduledPublishStatus: 'scheduled', scheduledPublishDate: now.toISOString() });
      const [outcome, cancelled] = await Promise.all([
        publishVideo(videos as never, meta('v', now), undefined, () => now),
        // api-videos cancel refuses once the video is published; it starts at a random moment
        pause(14).then(() => ownerUpdate(videos, 'v', (v) => {
          if (v.scheduledPublishStatus === 'published') return false;
          v.scheduledPublishStatus = 'cancelled';
          return true;
        })),
        ownerUpdate(videos, 'v', (v) => { v.description = `edit ${round}`; return true; }),
      ]);
      const v = videos.read('v');
      assert.equal(v.description, `edit ${round}`, 'the owner edit survives');
      if (cancelled) {
        cancelledWins++;
        assert.equal(outcome, 'cancelled');
        assert.equal(v.isPublic, false);
        assert.equal(v.scheduledPublishStatus, 'cancelled');
      } else {
        assert.equal(outcome, 'published');
        assert.equal(v.isPublic, true);
        assert.equal(v.scheduledPublishStatus, 'published');
      }
    }
    assert.ok(cancelledWins > 0 && cancelledWins < 200, `both orders happened (cancel won ${cancelledWins})`);
  });

  it('a video rescheduled to later is not published by the stale entry', async () => {
    const now = new Date('2026-11-09T12:00:00Z');
    const videos = new FakeR2(0);
    videos.set('v', { id: 'v', isPublic: false, scheduledPublishStatus: 'scheduled', scheduledPublishDate: '2026-11-10T12:00:00Z' });
    assert.equal(await publishVideo(videos as never, meta('v', now), undefined, () => now), 'rescheduled');
    assert.equal(videos.read('v').isPublic, false);
  });
});

describe('SC-2: the due scan is bounded and complete', () => {
  it('3000 entries over 4 days: oldest first, bounded reads, every due one is reached in a few runs', async () => {
    const now = new Date('2026-11-09T12:30:00Z');
    const bucket = new FakeR2(0);
    const due = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      // 1500 in one past hour (> 1000: needs pagination), the rest spread over 4 days back and 1 day ahead
      const at = i < 1500 ? new Date('2026-11-08T03:15:00Z') : new Date(now.getTime() + (Math.floor(Math.random() * 120) - 96) * 3600_000);
      const id = `v${i}`;
      bucket.set(buildScheduleKey(at, id), meta(id, at));
      if (at.getTime() < Date.parse('2026-11-09T12:31:00Z')) due.add(id); // due up to the end of this minute
    }
    bucket.set(`${FAILED_PREFIX}2026-11-01/00/old.json`, meta('old', new Date('2026-11-01T00:00:00Z')));

    const seen = new Set<string>();
    let runs = 0;
    while (seen.size < due.size) {
      bucket.reads = 0;
      bucket.lists = 0;
      const scan = await listDueSchedules(bucket as never, now, { limit: 50, maxReads: 200 });
      assert.ok(bucket.reads + bucket.lists <= 200, 'bounded R2 operations per run');
      assert.ok(scan.due.length <= 50);
      for (const m of scan.due) {
        assert.ok(due.has(m.videoId), 'only due entries');
        seen.add(m.videoId);
        // processed: the entry goes away, as after a publish
        bucket.data.delete(buildScheduleKey(new Date(m.scheduledPublishDate), m.videoId));
      }
      if (++runs > 200) throw new Error('scan never finished');
    }
    assert.equal(seen.size, due.size, 'every due entry, including those days overdue');
    assert.ok(!seen.has('old'), 'failed entries are never scanned');
  });
});

describe('SC-3: permanent failures leave the schedule', () => {
  it('after the last retry the entry moves to failed/ and the owner is told once', async () => {
    const at = new Date('2026-11-09T11:00:00Z');
    const bucket = new FakeR2(0);
    const m = meta('gone', at, { retryCount: 3 });
    bucket.set(buildScheduleKey(at, 'gone'), m);
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => { fetched.push(String(url)); return new Response('{}'); }) as never;
    try {
      await scheduleRetries([{ video: m, error: new Error('Video gone not found') }], { SCHEDULED_VIDEOS: bucket, MAX_RETRIES: '3', WEBSOCKET_URL: 'https://ws' } as never);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(bucket.data.has(buildScheduleKey(at, 'gone')), false);
    assert.equal(bucket.read(`${FAILED_PREFIX}${buildScheduleKey(at, 'gone')}`).error, 'Video gone not found');
    assert.equal((await listDueSchedules(bucket as never, new Date('2026-11-12T00:00:00Z'))).due.length, 0);
  });

  it('a retry moves the entry to its retry time and removes the old one', async () => {
    const at = new Date('2026-11-09T11:00:00Z');
    const bucket = new FakeR2(0);
    const m = meta('v', at);
    bucket.set(buildScheduleKey(at, 'v'), m);
    await scheduleRetries([{ video: m, error: new Error('boom') }], { SCHEDULED_VIDEOS: bucket, MAX_RETRIES: '3' } as never);
    const keys = [...bucket.data.keys()];
    assert.equal(keys.length, 1);
    assert.notEqual(keys[0], buildScheduleKey(at, 'v'));
    assert.equal(bucket.read(keys[0]).retryCount, 1);
  });

  it('markAsFailed copies before deleting', async () => {
    const at = new Date('2026-11-09T11:00:00Z');
    const bucket = new FakeR2(0);
    bucket.set(buildScheduleKey(at, 'v'), meta('v', at));
    await markAsFailed(bucket as never, meta('v', at), new Error('x'));
    assert.deepEqual([...bucket.data.keys()], [`${FAILED_PREFIX}${buildScheduleKey(at, 'v')}`]);
  });
});

describe('SC-4 and the whole run', () => {
  it('a run publishing 30 videos writes the metrics once; cancelled entries are dropped, not failed', async () => {
    const now = new Date();
    const videos = new FakeR2(1);
    const scheduled = new FakeR2(1);
    for (let i = 0; i < 32; i++) {
      const at = new Date(now.getTime() - 5 * 60_000);
      videos.set(`v${i}`, { id: `v${i}`, isPublic: false, scheduledPublishStatus: i < 30 ? 'scheduled' : 'cancelled' });
      scheduled.set(buildScheduleKey(at, `v${i}`), meta(`v${i}`, at));
    }
    const kv = new Map<string, string>();
    let kvPuts = 0;
    const KV = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kvPuts++; kv.set(k, v); } };
    const locks = new Set<string>();
    const lockNs = {
      idFromName: (n: string) => n,
      get: (n: string) => ({
        fetch: async (url: string) => {
          if (url.endsWith('/acquire')) {
            if (locks.has(n)) return Response.json({ acquired: false });
            locks.add(n);
            return Response.json({ acquired: true, token: 't' });
          }
          locks.delete(n);
          return Response.json({ released: true });
        },
      }),
    };
    const sent: unknown[] = [];
    const env = {
      VIDEOS: videos, SCHEDULED_VIDEOS: scheduled, QUEUE: { send: async (m: unknown) => void sent.push(m) },
      SCHEDULER_LOCKS: KV, SCHEDULER_METRICS: KV, SCHEDULER_LOCK: lockNs,
      MAX_RETRIES: '3', BATCH_SIZE: '50', LOCK_TTL: '120', WEBSOCKET_URL: '',
    };
    const waits: Promise<unknown>[] = [];
    await scheduler.scheduled({} as never, env as never, { waitUntil: (p: Promise<unknown>) => void waits.push(p) } as never);
    await Promise.all(waits);

    for (let i = 0; i < 30; i++) assert.equal(videos.read(`v${i}`).isPublic, true);
    assert.equal(videos.read('v30').isPublic, false);
    assert.equal(scheduled.data.size, 0, 'published and obsolete entries are all removed');
    const metrics = JSON.parse(kv.get(dailyMetricsKey(now))!);
    assert.equal(metrics.publishedToday, 30);
    assert.equal(metrics.failedToday, 0);
    assert.equal(kvPuts, 2, 'last_run plus one metrics write for the whole run');
    assert.equal(sent.length, 30, 'one search index update per published video');
  });

  it('runs add up in the day key', async () => {
    const kv = new Map<string, string>();
    const env = { SCHEDULER_METRICS: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) } };
    const at = new Date('2026-11-09T10:00:00Z');
    await recordRunMetrics(env as never, { published: 3, failed: 1, delaySeconds: 30 }, at);
    await recordRunMetrics(env as never, { published: 1, failed: 0, delaySeconds: 10 }, at);
    const m = JSON.parse(kv.get('daily_metrics:2026-11-09')!);
    assert.deepEqual([m.publishedToday, m.failedToday, m.averageDelay], [4, 1, 10]);
  });
});

describe('failed scheduled publish: flagged for an admin, retried from the Errors page', () => {
  it('reports a needs-action item when retries run out, and /failed/retry puts it back', async () => {
    const { handleSchedulerRequest, scheduledPublishKey } = await import('../src/failed-retry');
    const r2 = new FakeR2(0);
    const video = { videoId: 'vid-77', scheduledPublishDate: '2026-11-09T10:00:00.000Z', retryCount: 3 } as unknown as ScheduledVideoMetadata;
    r2.set(buildScheduleKey(new Date(video.scheduledPublishDate), video.videoId), video);
    const posts: Array<{ events?: Array<{ action?: Record<string, unknown> }> }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      if (init?.body) posts.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const pending: Promise<unknown>[] = [];
    const env = { SCHEDULED_VIDEOS: r2, MAX_RETRIES: '3', INTERNAL_API_KEY: 'k', ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors', WEBSOCKET_URL: '' } as never;
    try {
      await scheduleRetries([{ video, error: new Error('R2 write failed') }], env, { waitUntil: (p) => void pending.push(p) });
      await Promise.all(pending);
    } finally {
      globalThis.fetch = realFetch;
    }
    const item = posts.flatMap((p) => p.events ?? []).find((e) => e.action)?.action;
    assert.equal(item?.key, scheduledPublishKey('vid-77'));
    assert.deepEqual(item?.retry, { kind: 'service', service: 'scheduler', path: '/failed/retry', body: { videoId: 'vid-77', scheduledPublishDate: video.scheduledPublishDate } });

    const call = (key: string, body: unknown) =>
      handleSchedulerRequest(new Request('https://scheduler.internal/failed/retry', { method: 'POST', headers: { 'X-API-Key': key }, body: JSON.stringify(body) }), env);
    assert.equal((await call('wrong', item?.retry && (item.retry as { body: unknown }).body)).status, 401);
    assert.equal((await call('k', (item!.retry as { body: unknown }).body)).status, 200);
    assert.ok(![...r2.data.keys()].some((k) => k.startsWith(FAILED_PREFIX)), 'no longer in failed/');
    const back = [...r2.data.entries()].find(([k]) => k.endsWith('/vid-77.json'));
    assert.equal(JSON.parse(back![1].body).retryCount, 0);
    assert.equal((await call('k', (item!.retry as { body: unknown }).body)).status, 404, 'a second retry finds nothing');
  });
});

describe('transient R2 errors (2026-11-11 "list: We encountered an internal error. Please try again. (10001)")', async () => {
  const { STORAGE_RETRY, isTransientStorageError, withStorageRetry, TransientStorageError } = await import('../src/lib/storage-retry');
  const { OUTAGE_KEY, ESCALATE_AFTER } = await import('../src/storage-outage');
  STORAGE_RETRY.baseDelayMs = 1;
  const r2Error = (code = '10001') => new Error(`list: We encountered an internal error. Please try again. (${code})`);

  /** R2 whose list fails the first `failLists` calls (Infinity: always) */
  class FlakyR2 extends FakeR2 {
    constructor(public failLists = 0) { super(0); }
    override async list(opts: { limit?: number; cursor?: string; prefix?: string } = {}) {
      if (this.failLists > 0) { this.failLists--; this.lists++; throw r2Error(); }
      return super.list(opts);
    }
  }

  function runEnv(scheduled: unknown, videos = new FakeR2(0)) {
    const kv = new Map<string, string>();
    const KV = {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    };
    const lockNs = {
      idFromName: (n: string) => n,
      get: () => ({ fetch: async (url: string) => Response.json(url.endsWith('/acquire') ? { acquired: true, token: 't' } : { released: true }) }),
    };
    const env = {
      VIDEOS: videos, SCHEDULED_VIDEOS: scheduled, QUEUE: { send: async () => undefined },
      SCHEDULER_LOCKS: KV, SCHEDULER_METRICS: KV, SCHEDULER_LOCK: lockNs,
      MAX_RETRIES: '3', BATCH_SIZE: '50', LOCK_TTL: '120', WEBSOCKET_URL: '',
      INTERNAL_API_KEY: 'k', ERRORS_INGEST_URL: 'https://admin.api.qa.example/internal/errors',
    };
    const reports: string[] = [];
    const run = async () => {
      const waits: Promise<unknown>[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
        for (const e of JSON.parse(String(init?.body ?? '{}')).events ?? []) reports.push(String(e.message));
        return new Response(null, { status: 202 });
      }) as typeof fetch;
      try {
        await scheduler.scheduled({} as never, env as never, { waitUntil: (p: Promise<unknown>) => void waits.push(p) } as never);
        await Promise.all(waits);
      } finally {
        globalThis.fetch = realFetch;
      }
    };
    return { env, kv, reports, run };
  }

  it('classifies: R2 internal error is transient; a bad binding or another R2 code is not', () => {
    assert.equal(isTransientStorageError(r2Error()), true);
    assert.equal(isTransientStorageError(r2Error('10058')), true);
    assert.equal(isTransientStorageError(new TypeError("Cannot read properties of undefined (reading 'list')")), false);
    assert.equal(isTransientStorageError(new Error('get: The specified bucket does not exist. (10006)')), false);
  });

  it('retries a transient error, gives up after 2 retries, never retries a non-transient one', async () => {
    let calls = 0;
    assert.equal(await withStorageRetry('list', async () => { if (++calls === 1) throw r2Error(); return 'ok'; }), 'ok');
    assert.equal(calls, 2);
    calls = 0;
    await assert.rejects(withStorageRetry('list', async () => { calls++; throw r2Error(); }), (e: unknown) => e instanceof TransientStorageError && e.code === '10001');
    assert.equal(calls, 3);
    calls = 0;
    await assert.rejects(withStorageRetry('list', async () => { calls++; throw new TypeError('bad binding'); }), TypeError);
    assert.equal(calls, 1);
  });

  it('a transient list error then success: the run publishes, nothing is reported', async () => {
    const at = new Date(Date.now() - 60_000);
    const scheduled = new FlakyR2(1);
    scheduled.set(buildScheduleKey(at, 'v1'), meta('v1', at));
    const videos = new FakeR2(0);
    videos.set('v1', { id: 'v1', isPublic: false, scheduledPublishStatus: 'scheduled' });
    const { kv, reports, run } = runEnv(scheduled, videos);
    await run();
    assert.equal(videos.read('v1').isPublic, true);
    assert.equal(scheduled.data.size, 0);
    assert.equal(kv.has(OUTAGE_KEY), false);
    assert.deepEqual(reports, []);
  });

  it('list failing every time: each run ends cleanly and counts; reported once, at the 5th run; a good run resets', async () => {
    const at = new Date(Date.now() - 60_000);
    const scheduled = new FlakyR2(Infinity);
    scheduled.set(buildScheduleKey(at, 'v1'), meta('v1', at));
    const videos = new FakeR2(0);
    videos.set('v1', { id: 'v1', isPublic: false, scheduledPublishStatus: 'scheduled' });
    const { kv, reports, run } = runEnv(scheduled, videos);
    for (let i = 1; i <= ESCALATE_AFTER + 1; i++) {
      await run(); // does not throw
      assert.equal(JSON.parse(kv.get(OUTAGE_KEY)!).count, i);
      assert.equal(JSON.parse(kv.get(OUTAGE_KEY)!).code, '10001');
      assert.equal(reports.length, i >= ESCALATE_AFTER ? 1 : 0, `reports after run ${i}`);
    }
    assert.equal(scheduled.lists, 3 * (ESCALATE_AFTER + 1), 'one try and two retries per run');
    assert.match(reports[0], /storage unavailable for 5 consecutive runs/);
    assert.equal(JSON.parse(kv.get(dailyMetricsKey(new Date()))!).storageErrorsToday, ESCALATE_AFTER + 1);

    scheduled.failLists = 0;
    await run();
    assert.equal(kv.has(OUTAGE_KEY), false, 'the count is reset by a run that gets through');
    assert.equal(videos.read('v1').isPublic, true, 'and the due video is published');
    scheduled.failLists = Infinity;
    await run();
    assert.equal(JSON.parse(kv.get(OUTAGE_KEY)!).count, 1, 'a new outage counts from 1');
  });

  it('a non-transient error (missing binding) is reported at once and not counted', async () => {
    const { kv, reports, run } = runEnv(undefined);
    await run();
    assert.equal(kv.has(OUTAGE_KEY), false);
    assert.equal(reports.length, 1);
  });
});

describe('#1240: a released video reaches the subscribers', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const scheduled = (extra: Record<string, unknown> = {}) => ({
    id: 'v', title: 'Lesson 1', userId: 'u', channelId: 'ch', isPublic: false, isDraft: false,
    scheduledPublishStatus: 'scheduled', scheduledPublishDate: now.toISOString(), uploadStatus: 'ready', ...extra,
  });
  const setup = (video: Record<string, unknown>) => {
    const videos = new FakeR2(0);
    videos.set('v', video);
    const channels = new FakeR2(0);
    channels.set('ch', { id: 'ch', name: 'Al Ummah', nameLocalized: { ar: 'الأمة' } });
    const sent: Array<{ type: number; payload: any }> = [];
    const queue = { send: async (m: { type: number; payload: unknown }) => { sent.push(m as never); } };
    return { videos, channels, sent, queue };
  };

  it('ready at release: published with publishedAt, search sync and one "new video" fan-out with the channel name', async () => {
    const { videos, channels, sent, queue } = setup(scheduled());
    assert.equal(await publishVideo(videos as never, meta('v', now), queue as never, () => now, channels as never), 'published');
    const v = videos.read('v');
    assert.equal(v.isPublic, true);
    assert.equal(v.publishedAt, now.toISOString());
    assert.deepEqual(sent.map((m) => m.type), [MessageType.SearchIndexSync, MessageType.NotificationFanout]);
    const fanout = sent.find((m) => m.payload?.kind === 'new_video');
    assert.ok(fanout, 'a new_video fan-out was queued');
    assert.deepEqual(fanout.payload, {
      kind: 'new_video', channelId: 'ch', entityId: 'v', isHighlight: true,
      params: { channelName: 'Al Ummah', channelName_ar: 'الأمة', videoTitle: 'Lesson 1' },
      actionUrl: '/video/v', actorUserId: 'u',
    });
  });

  it('still processing at release: public, but no publishedAt and no fan-out (the processing loop announces it when ready)', async () => {
    const { videos, channels, sent, queue } = setup(scheduled({ uploadStatus: 'processing' }));
    assert.equal(await publishVideo(videos as never, meta('v', now), queue as never, () => now, channels as never), 'published');
    const v = videos.read('v');
    assert.equal(v.isPublic, true);
    assert.equal(v.scheduledPublishStatus, 'published');
    assert.equal(v.publishedAt, undefined);
    assert.equal(sent.some((m) => m.payload?.kind === 'new_video'), false);
  });

  it('a Short is announced without the highlight flag; a channel that cannot be read still announces', async () => {
    const { videos, sent, queue } = setup(scheduled({ format: 'short' }));
    await publishVideo(videos as never, meta('v', now), queue as never, () => now, undefined);
    const fanout = sent.find((m) => m.payload?.kind === 'new_video');
    assert.equal(fanout?.payload.isHighlight, false);
    assert.deepEqual(fanout?.payload.params, { channelName: '', videoTitle: 'Lesson 1' });
  });

  it('a video hidden by moderation meanwhile is released but never announced', async () => {
    const { videos, channels, sent, queue } = setup(scheduled({ isHidden: true }));
    await publishVideo(videos as never, meta('v', now), queue as never, () => now, channels as never);
    assert.equal(sent.some((m) => m.payload?.kind === 'new_video'), false);
  });
});
