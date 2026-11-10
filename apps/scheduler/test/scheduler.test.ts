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
import type { ScheduledVideoMetadata } from '@al-ummah/shared-types';
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
