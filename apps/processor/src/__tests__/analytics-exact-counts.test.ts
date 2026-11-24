/**
 * Exactly-once analytics counters (#1921):
 * - A failed D1 flush never acknowledges counter-bearing messages; they are retried
 *   with bounded backoff and routed to the DLQ after max_retries.
 * - Per-message dedupe markers (analytics_dedupe, migration 0023, PK (day_bucket, message_id)
 *   WITHOUT ROWID and no secondary index: 1 row written on insert + 1 on purge) commit in the
 *   same D1 batch transaction as analytics_daily upserts, so redeliveries and duplicates are
 *   no-ops and mid-batch failures roll back cleanly.
 * - Hourly bounded PK-prefix purge in 1,000-row chunks; zero table scans.
 *
 * Runs the real SQL on node:sqlite.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@al-ummah/logger';
import worker, {
  ANALYTICS_FLUSH_RETRY_DELAYS_SECONDS,
  ROLLUP_IMPORT_CRON,
  VIDEOS_MAX_RETRIES,
  analyticsFlushRetryDelaySeconds,
  runAnalyticsDedupePurge,
  runScheduled,
} from '../index';
import { MessageProcessor } from '../messageProcessor';
import {
  ANALYTICS_DEDUPE_PURGE_BATCH,
  ANALYTICS_DEDUPE_TTL_DAYS,
  ANALYTICS_DEDUPE_TTL_MS,
  BOUNDED_UPSERT_DEDUPED,
  BULK_UPSERT_DEDUPED,
  CounterBatch,
  DEDUPE_INSERT,
  purgeExpiredAnalyticsDedupe,
  readCounters,
  resolveMessageBuckets,
} from '../lib/analytics-counters';
import { processDeadLetterBatch } from '../dlq/consumer';
import { replayDeadLetter } from '../dlq/store';
import { MessageType, type AlUmmahMessage, type D1Database, type QueueEnvironment } from '../types';
import { createSqliteD1 } from './sqlite-d1';

const DAY = '2026-11-24';
const AT = `${DAY}T10:00:00.000Z`;
const logger = createLogger('analytics-exact-test', { logLevel: 'error' });

function qMsg(body: AlUmmahMessage, opts: { queueId?: string; attempts?: number } = {}) {
  return {
    id: opts.queueId ?? `q-${body.id}`,
    body,
    attempts: opts.attempts ?? 1,
    ack: jest.fn(),
    retry: jest.fn(),
  };
}

function viewMsg(id: string, over: Record<string, unknown> = {}): AlUmmahMessage {
  return {
    id,
    type: MessageType.VideoView,
    timestamp: AT,
    payload: {
      videoId: 'v1',
      videoChannelId: 'c1',
      trackedView: true,
      watchTime: 5,
      source: 'embed',
      embedOrigin: 'https://embed.example.org',
      trafficSource: 'external',
      referrerHost: 'ref.example.org',
      originSurface: 'web',
      originDevice: 'desktop',
      originCountry: 'US',
      rankViewer: `u:viewer-${id}`,
      timestamp: AT,
      ...over,
    },
  };
}

function watchTimeMsg(id: string, seconds = 30, over: Record<string, unknown> = {}): AlUmmahMessage {
  return {
    id,
    type: MessageType.VideoWatchTime,
    timestamp: AT,
    payload: { videoId: 'v1', videoChannelId: 'c1', seconds, timestamp: AT, ...over },
  };
}

function retentionMsg(id: string, buckets = [0, 1, 2], over: Record<string, unknown> = {}): AlUmmahMessage {
  return {
    id,
    type: MessageType.VideoRetention,
    timestamp: AT,
    payload: { videoId: 'v1', buckets, timestamp: AT, ...over },
  };
}

function visitMsg(id: string): AlUmmahMessage {
  return {
    id,
    type: MessageType.ClientAnalyticsEvent,
    timestamp: AT,
    payload: {
      kind: 'visit',
      receivedAt: AT,
      events: [{ landing: 'watch', source: 'search:google', referrerHost: 'www.google.com' }],
    },
  };
}

function profileMsg(id: string): AlUmmahMessage {
  return {
    id,
    type: MessageType.ProfileCreate,
    timestamp: AT,
    payload: { userId: `user-${id}` },
  };
}

function makeEnv(db: D1Database, overrides: Partial<QueueEnvironment> = {}): QueueEnvironment {
  return {
    MESSAGE_QUEUE: { send: jest.fn().mockResolvedValue(undefined) },
    DLQ: { send: jest.fn().mockResolvedValue(undefined) },
    MESSAGES_BUCKET: { put: jest.fn().mockResolvedValue(undefined), get: jest.fn().mockResolvedValue(null), list: jest.fn() },
    community_posts: { put: jest.fn(), get: jest.fn(), list: jest.fn() },
    REPORTS_DB: {
      prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) }),
    } as unknown as D1Database,
    NOTIFICATIONS_DB: db,
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'error',
    MESSAGE_ARCHIVE: 'off',
    ...overrides,
  };
}

function metricValue(db: ReturnType<typeof createSqliteD1>, entityType: string, entityId: string, metric: string, dim = ''): number {
  const row = db.raw
    .prepare('SELECT value FROM analytics_daily WHERE entity_type = ? AND entity_id = ? AND day = ? AND metric = ? AND dim = ?')
    .get(entityType, entityId, DAY, metric, dim) as { value?: number } | undefined;
  return Number(row?.value ?? 0);
}

describe('exact analytics counts (#1921)', () => {
  it('a failed flush does not ack and a following redelivery counts views, watch-time, retention, site visits and viewers exactly once', async () => {
    const db = createSqliteD1();
    const realBatch = db.batch.bind(db);
    let failFlush = true;
    const flakyDb: D1Database = {
      ...db,
      batch: async (statements) => {
        if (failFlush) throw new Error('D1 temporarily overloaded');
        return realBatch(statements);
      },
    };
    const env = makeEnv(flakyDb);

    // Delivery 1: flush fails -> none of the analytics messages are acked, all are retried
    const first = [qMsg(viewMsg('v-1')), qMsg(watchTimeMsg('wt-1', 45)), qMsg(retentionMsg('ret-1', [0, 3])), qMsg(visitMsg('vis-1'))];
    await worker.queue({ queue: 'al-ummah-now-videos', messages: first } as never, env);

    for (const m of first) {
      expect(m.ack).not.toHaveBeenCalled();
      expect(m.retry).toHaveBeenCalledTimes(1);
      expect(m.retry).toHaveBeenCalledWith({ delaySeconds: ANALYTICS_FLUSH_RETRY_DELAYS_SECONDS[0] });
    }
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_daily').get()).toEqual({ n: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_dedupe').get()).toEqual({ n: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM discovery_viewers').get()).toEqual({ n: 0 });

    // Delivery 2: D1 recovers -> redelivery succeeds, acks all messages, counts each exactly once
    failFlush = false;
    const redelivered = [
      qMsg(viewMsg('v-1'), { attempts: 2 }),
      qMsg(watchTimeMsg('wt-1', 45), { attempts: 2 }),
      qMsg(retentionMsg('ret-1', [0, 3]), { attempts: 2 }),
      qMsg(visitMsg('vis-1'), { attempts: 2 }),
    ];
    await worker.queue({ queue: 'al-ummah-now-videos', messages: redelivered } as never, env);

    for (const m of redelivered) {
      expect(m.ack).toHaveBeenCalledTimes(1);
      expect(m.retry).not.toHaveBeenCalled();
    }
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(1);
    expect(metricValue(db, 'channel', 'c1', 'views')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'watch_time')).toBe(50); // 5 from view + 45 from watch-time
    expect(metricValue(db, 'channel', 'c1', 'watch_time')).toBe(50);
    expect(metricValue(db, 'video', 'v1', 'retention_start')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'retention', '0')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'retention', '3')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'source', 'embed')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'embed_origin', 'https://embed.example.org')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'external_host', 'ref.example.org')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'country', 'US')).toBe(1);
    expect(metricValue(db, 'site', 'videos', 'visits')).toBe(1);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM discovery_viewers').get()).toEqual({ n: 1 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_dedupe').get()).toEqual({ n: 4 });
  });

  it('a statement failing mid-batch on real SQLite rolls back both analytics_daily and analytics_dedupe', async () => {
    const db = createSqliteD1();
    const batch = new CounterBatch();
    const incs = [
      { entityType: 'video' as const, entityId: 'v1', day: DAY, metric: 'views', value: 1 },
      { entityType: 'video' as const, entityId: 'v1', day: DAY, metric: 'source', dim: 'embed', value: 1, maxDims: 10 },
    ];
    batch.addForMessage('rb-1', incs, AT);

    // Counter upserts and dedupe insert execute first, then a trailing statement fails inside the same transaction
    await expect(
      batch.flush(db, 1, {
        now: Date.parse(AT),
        extraStatements: [db.prepare('INSERT INTO no_such_table VALUES (1)')],
      }),
    ).rejects.toThrow(/no such table/i);

    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_daily').get()).toEqual({ n: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_dedupe').get()).toEqual({ n: 0 });

    // Retry without the failing statement commits cleanly and counts once
    const retry = new CounterBatch();
    retry.addForMessage('rb-1', incs, AT);
    await retry.flush(db, 1, { now: Date.parse(AT) });
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'source', 'embed')).toBe(1);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_dedupe').get()).toEqual({ n: 1 });
  });

  it('concurrent flushes over the same message ids count each message exactly once', async () => {
    const db = createSqliteD1();
    const now = Date.parse(AT);
    const incs = (videoId: string) => [
      { entityType: 'video' as const, entityId: videoId, day: DAY, metric: 'views', value: 1 },
      { entityType: 'video' as const, entityId: videoId, day: DAY, metric: 'watch_time', value: 15 },
      { entityType: 'video' as const, entityId: videoId, day: DAY, metric: 'source', dim: 'watch', value: 1, maxDims: 10 },
    ];

    // 10 concurrent CounterBatch flushes racing on the exact same two message ids
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        const b = new CounterBatch();
        b.addForMessage('race-1', incs('v1'), AT);
        b.addForMessage('race-2', incs('v1'), AT);
        await b.flush(db, 3, { now });
      }),
    );

    expect(metricValue(db, 'video', 'v1', 'views')).toBe(2);
    expect(metricValue(db, 'video', 'v1', 'watch_time')).toBe(30);
    expect(metricValue(db, 'video', 'v1', 'source', 'watch')).toBe(2);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_dedupe').get()).toEqual({ n: 2 });

    // Concurrent worker.queue batches carrying overlapping message ids
    const env = makeEnv(db);
    await Promise.all([
      worker.queue({ queue: 'al-ummah-now-videos', messages: [qMsg(viewMsg('q-race-1')), qMsg(watchTimeMsg('q-race-2', 20))] } as never, env),
      worker.queue({ queue: 'al-ummah-now-videos', messages: [qMsg(viewMsg('q-race-1')), qMsg(retentionMsg('q-race-3', [0, 1]))] } as never, env),
      worker.queue({ queue: 'al-ummah-now-videos', messages: [qMsg(watchTimeMsg('q-race-2', 20)), qMsg(retentionMsg('q-race-3', [0, 1]))] } as never, env),
    ]);

    expect(metricValue(db, 'video', 'v1', 'views')).toBe(3); // race-1, race-2, q-race-1
    expect(metricValue(db, 'video', 'v1', 'watch_time')).toBe(55); // 30 + 5 + 20
    expect(metricValue(db, 'video', 'v1', 'retention_start')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'retention', '1')).toBe(1);
  });

  it('a timeout after D1 commit during internal retry still counts exactly once', async () => {
    const db = createSqliteD1();
    const realBatch = db.batch.bind(db);
    let calls = 0;
    const ambiguousDb: D1Database = {
      ...db,
      batch: async (statements) => {
        calls++;
        const res = await realBatch(statements);
        if (calls === 1) throw new Error('D1 response timed out after commit');
        return res;
      },
    };
    const env = makeEnv(ambiguousDb);
    const msgs = [qMsg(viewMsg('amb-1')), qMsg(watchTimeMsg('amb-2', 20)), qMsg(retentionMsg('amb-3', [0, 5]))];
    await worker.queue({ queue: 'al-ummah-now-videos', messages: msgs } as never, env);

    expect(calls).toBe(2);
    for (const m of msgs) expect(m.ack).toHaveBeenCalledTimes(1);
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'watch_time')).toBe(25);
    expect(metricValue(db, 'video', 'v1', 'retention_start')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'retention', '5')).toBe(1);
  });

  it('a duplicate delivery (in batch, across batches, and across UTC midnight) counts once', async () => {
    const db = createSqliteD1();
    const env = makeEnv(db);

    // Same message delivered twice inside the same batch
    const inBatchDup = [qMsg(viewMsg('dup-1'), { queueId: 'q-a' }), qMsg(viewMsg('dup-1'), { queueId: 'q-b' })];
    await worker.queue({ queue: 'al-ummah-now-videos', messages: inBatchDup } as never, env);
    expect(inBatchDup[0].ack).toHaveBeenCalledTimes(1);
    expect(inBatchDup[1].ack).toHaveBeenCalledTimes(1);
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'source', 'embed')).toBe(1);

    // First delivery of watch-time + retention + site visit
    const first = [qMsg(watchTimeMsg('dup-wt', 35)), qMsg(retentionMsg('dup-ret', [0, 4])), qMsg(visitMsg('dup-vis'))];
    await worker.queue({ queue: 'al-ummah-now-videos', messages: first } as never, env);

    // Redelivery of every already-processed message in a later batch -> complete no-op
    const changesBefore = db.raw.prepare('SELECT total_changes() AS n').get() as { n: number };
    const redelivery = [
      qMsg(viewMsg('dup-1')),
      qMsg(watchTimeMsg('dup-wt', 35)),
      qMsg(retentionMsg('dup-ret', [0, 4])),
      qMsg(visitMsg('dup-vis')),
    ];
    await worker.queue({ queue: 'al-ummah-now-videos', messages: redelivery } as never, env);
    const changesAfter = db.raw.prepare('SELECT total_changes() AS n').get() as { n: number };

    for (const m of redelivery) {
      expect(m.ack).toHaveBeenCalledTimes(1);
      expect(m.retry).not.toHaveBeenCalled();
    }
    expect(changesAfter.n).toBe(changesBefore.n);
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(1);
    expect(metricValue(db, 'channel', 'c1', 'views')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'watch_time')).toBe(40); // 5 + 35
    expect(metricValue(db, 'video', 'v1', 'retention_start')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'retention', '4')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'embed_origin', 'https://embed.example.org')).toBe(1);
    expect(metricValue(db, 'site', 'videos', 'visits')).toBe(1);

    // Stale/clamped timestamp straddling UTC midnight still hits the neighbouring day_bucket
    const staleTs = '2026-10-01T12:00:00.000Z';
    const b1 = new CounterBatch();
    b1.addForMessage('midnight-1', [{ entityType: 'video', entityId: 'v-mid', day: DAY, metric: 'views', value: 1 }], staleTs);
    await b1.flush(db, 1, { now: Date.parse('2026-11-24T23:59:59.000Z') });

    const b2 = new CounterBatch();
    b2.addForMessage('midnight-1', [{ entityType: 'video', entityId: 'v-mid', day: DAY, metric: 'views', value: 1 }], staleTs);
    await b2.flush(db, 1, { now: Date.parse('2026-11-25T00:00:01.000Z') });

    expect(metricValue(db, 'video', 'v-mid', 'views')).toBe(1);
  });

  it('a partial batch failure (per-message, mixed-batch flush, or refused increment) counts each valid message exactly once', async () => {
    const db = createSqliteD1();

    // Case 1: One message in a batch fails before counter recording (R2 archive error),
    // while the other messages succeed and flush. Then the failed message is redelivered
    // alongside duplicates of already-counted messages and a brand-new message.
    const r2Put = jest.fn(async (key: string) => {
      if (key.endsWith('.p-fail')) throw new Error('R2 transient error');
    });
    const env = makeEnv(db, {
      MESSAGE_ARCHIVE: 'all',
      MESSAGES_BUCKET: { put: r2Put, get: jest.fn().mockResolvedValue(null), list: jest.fn() },
    });

    const batch1 = [qMsg(viewMsg('p-ok-1')), qMsg(viewMsg('p-fail')), qMsg(watchTimeMsg('p-wt-1', 25)), qMsg(retentionMsg('p-ret-1', [0, 2]))];
    await worker.queue({ queue: 'al-ummah-now-videos', messages: batch1 } as never, env);

    expect(batch1[0].ack).toHaveBeenCalledTimes(1);
    expect(batch1[1].ack).not.toHaveBeenCalled();
    expect(batch1[1].retry).toHaveBeenCalledTimes(1);
    expect(batch1[2].ack).toHaveBeenCalledTimes(1);
    expect(batch1[3].ack).toHaveBeenCalledTimes(1);
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'watch_time')).toBe(30); // 5 + 25
    expect(metricValue(db, 'video', 'v1', 'retention_start')).toBe(1);

    // R2 recovers; redelivery mixes p-fail (new), p-ok-1 (duplicate), p-wt-1 (duplicate), and p-ok-2 (new)
    r2Put.mockResolvedValue(undefined);
    const batch2 = [
      qMsg(viewMsg('p-fail'), { attempts: 2 }),
      qMsg(viewMsg('p-ok-1'), { attempts: 2 }),
      qMsg(watchTimeMsg('p-wt-1', 25), { attempts: 2 }),
      qMsg(viewMsg('p-ok-2')),
    ];
    await worker.queue({ queue: 'al-ummah-now-videos', messages: batch2 } as never, env);

    for (const m of batch2) {
      expect(m.ack).toHaveBeenCalledTimes(1);
      expect(m.retry).not.toHaveBeenCalled();
    }
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(3); // p-ok-1, p-fail, p-ok-2
    expect(metricValue(db, 'channel', 'c1', 'views')).toBe(3);
    expect(metricValue(db, 'video', 'v1', 'watch_time')).toBe(40); // 3*5 + 25
    expect(metricValue(db, 'video', 'v1', 'retention_start')).toBe(1);
    expect(metricValue(db, 'video', 'v1', 'source', 'embed')).toBe(3);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM discovery_viewers').get()).toEqual({ n: 3 });

    // Case 2: Mixed batch with a non-counter message + counter messages when flush fails.
    // The non-counter message is acked and never retried; only the counter messages retry.
    const realBatch = db.batch.bind(db);
    let fail = true;
    const flakyEnv = makeEnv({
      ...db,
      batch: async (stmts) => {
        if (fail) throw new Error('D1 busy');
        return realBatch(stmts);
      },
    });
    const mixed = [qMsg(profileMsg('non-counter')), qMsg(viewMsg('p-mixed-1')), qMsg(watchTimeMsg('p-mixed-wt', 15))];
    await worker.queue({ queue: 'al-ummah-now-videos', messages: mixed } as never, flakyEnv);

    expect(mixed[0].ack).toHaveBeenCalledTimes(1);
    expect(mixed[0].retry).not.toHaveBeenCalled();
    expect(mixed[1].ack).not.toHaveBeenCalled();
    expect(mixed[1].retry).toHaveBeenCalledTimes(1);
    expect(mixed[2].ack).not.toHaveBeenCalled();
    expect(mixed[2].retry).toHaveBeenCalledTimes(1);

    fail = false;
    const mixedRetry = [qMsg(viewMsg('p-mixed-1'), { attempts: 2 }), qMsg(watchTimeMsg('p-mixed-wt', 15), { attempts: 2 })];
    await worker.queue({ queue: 'al-ummah-now-videos', messages: mixedRetry } as never, flakyEnv);
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(4);
    expect(metricValue(db, 'video', 'v1', 'watch_time')).toBe(60); // 40 + 5 + 15

    // Case 3 (N3): One bad/invalid increment in a batch of 10 is refused before SQL and never fails the other 9
    const refused: string[] = [];
    const batchOfTen = new CounterBatch((_inc, reason) => refused.push(reason));
    for (let i = 0; i < 9; i++) {
      batchOfTen.addForMessage(`good-${i}`, [{ entityType: 'video', entityId: 'v-ten', day: DAY, metric: 'views', value: 1 }], AT);
    }
    batchOfTen.addForMessage('bad-1', [{ entityType: 'video', entityId: 'v-ten', day: 'not-a-day', metric: 'views', value: Number.NaN }], AT);
    await batchOfTen.flush(db, 1, { now: Date.parse(AT) });
    expect(refused).toEqual(['invalid_key']);
    expect(metricValue(db, 'video', 'v-ten', 'views')).toBe(9);
  });

  it('single-message mode returns failure with shouldRetry on D1 flush error', async () => {
    const brokenDb = {
      prepare: () => ({ bind: () => ({}) }),
      batch: jest.fn().mockRejectedValue(new Error('D1 down')),
    } as unknown as D1Database;
    const processor = new MessageProcessor(logger);
    const res = await processor.processMessage(viewMsg('single-1'), makeEnv(brokenDb));
    expect(res.success).toBe(false);
    expect(res.shouldRetry).toBe(true);
    expect(res.error).toContain('D1 down');
  });

  it('bounds retries, enforces message_retention_period <= TTL/2, and blocks duplicate DLQ replays even > 8 days apart', async () => {
    // Verify retry schedule matches wrangler max_retries
    expect(analyticsFlushRetryDelaySeconds(1)).toBe(ANALYTICS_FLUSH_RETRY_DELAYS_SECONDS[0]);
    expect(analyticsFlushRetryDelaySeconds(2)).toBe(ANALYTICS_FLUSH_RETRY_DELAYS_SECONDS[1]);
    expect(analyticsFlushRetryDelaySeconds(3)).toBe(ANALYTICS_FLUSH_RETRY_DELAYS_SECONDS[2]);
    expect(analyticsFlushRetryDelaySeconds(VIDEOS_MAX_RETRIES + 1)).toBeUndefined();

    // Verify wrangler configs bound retries, wire the DLQ, and never set message_retention_period > TTL / 2 (N1)
    const DEFAULT_CF_QUEUE_RETENTION_SECONDS = 4 * 86_400; // Cloudflare Queues default: 4 days
    for (const file of ['wrangler.jsonc', 'wrangler.qa.jsonc']) {
      const text = readFileSync(join(__dirname, '..', '..', file), 'utf8');
      expect(text).toMatch(/"queue":\s*"al-ummah-now-videos[\s\S]*?"max_retries":\s*3[\s\S]*?"dead_letter_queue":\s*"al-ummah-now-dlq/);
      const retentionMatches = [...text.matchAll(/"message_retention_period":\s*(\d+)/g)];
      const maxRetention = retentionMatches.length ? Math.max(...retentionMatches.map((m) => Number(m[1]))) : DEFAULT_CF_QUEUE_RETENTION_SECONDS;
      expect(ANALYTICS_DEDUPE_TTL_DAYS * 86_400).toBeGreaterThanOrEqual(2 * maxRetention);
    }

    const db = createSqliteD1();
    const failingDb: D1Database = {
      ...db,
      batch: async () => {
        throw new Error('D1 outage');
      },
    };
    const body = viewMsg('dlq-v-1', { rankViewer: undefined });
    // On final delivery (attempts > VIDEOS_MAX_RETRIES), retry() is called without delay so Cloudflare moves it to DLQ
    const finalAttempt = qMsg(body, { attempts: VIDEOS_MAX_RETRIES + 1 });
    await worker.queue({ queue: 'al-ummah-now-videos', messages: [finalAttempt] } as never, makeEnv(failingDb));
    expect(finalAttempt.ack).not.toHaveBeenCalled();
    expect(finalAttempt.retry).toHaveBeenCalledWith();

    // DLQ consumer stores it; once D1 is healthy, admin replays it and it counts once (and not twice if redelivered)
    const dlqDelivery = { id: 'dlq-1', body, attempts: 4, ack: jest.fn(), retry: jest.fn() };
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq', messages: [dlqDelivery] }, { NOTIFICATIONS_DB: db, ENVIRONMENT: 'test' }, logger, Date.parse(AT));
    expect(dlqDelivery.ack).toHaveBeenCalled();

    const replayed: AlUmmahMessage[] = [];
    const outcome = await replayDeadLetter(db, { send: async (m) => { replayed.push(m); } }, 'dlq-1', Date.parse(AT) + 1000);
    expect(outcome).toEqual({ status: 'replayed', messageId: 'dlq-v-1' });
    expect(replayed).toHaveLength(1);

    const healthyEnv = makeEnv(db);
    await worker.queue({ queue: 'al-ummah-now-videos', messages: [qMsg(replayed[0])] } as never, healthyEnv);
    await worker.queue({ queue: 'al-ummah-now-videos', messages: [qMsg(replayed[0])] } as never, healthyEnv);
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(1);

    // N2: Even > 8 days later after analytics_dedupe purges the marker, dead_letters.replayed_at blocks a second replay
    const tenDaysLater = Date.parse(AT) + (ANALYTICS_DEDUPE_TTL_DAYS + 2) * 86_400_000;
    await purgeExpiredAnalyticsDedupe(db, tenDaysLater);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_dedupe').get()).toEqual({ n: 0 });
    const secondReplay = await replayDeadLetter(db, { send: async (m) => { replayed.push(m); } }, 'dlq-1', tenDaysLater);
    expect(secondReplay).toEqual({ status: 'already_replayed' });
    expect(replayed).toHaveLength(1);
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(1);
  });

  it('has no secondary index on analytics_dedupe, merges hot batches, and runs zero table scans', async () => {
    const db = createSqliteD1();

    // S1: No secondary index on analytics_dedupe -> 1 row written on insert + 1 on purge delete
    const secondaryIndexes = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'analytics_dedupe'")
      .all() as { name: string }[];
    expect(secondaryIndexes).toEqual([]);

    const batchSpy = jest.spyOn(db, 'batch');
    const env = makeEnv(db);

    // 10 views of the same hot video in one batch -> 1 D1 transaction, 1 row per counter key
    const hotBatch = Array.from({ length: 10 }, (_, i) => qMsg(viewMsg(`hot-${i}`)));
    await worker.queue({ queue: 'al-ummah-now-videos', messages: hotBatch } as never, env);

    expect(batchSpy).toHaveBeenCalledTimes(1);
    const statementsSent = batchSpy.mock.calls[0][0];
    // 1 plain bulk upsert + bounded dims (shared across all 10 messages, NOT 10x) + 1 dedupe insert + 1 discovery_viewers insert
    expect(statementsSent.length).toBeLessThanOrEqual(25);
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(10);
    expect(metricValue(db, 'channel', 'c1', 'views')).toBe(10);
    expect(metricValue(db, 'video', 'v1', 'source', 'embed')).toBe(10);
    expect(await readCounters(db, 'video', ['v1'], DAY, DAY, ['views'])).toEqual([
      { entity_type: 'video', entity_id: 'v1', day: DAY, metric: 'views', dim: '', value: 10 },
    ]);

    // EXPLAIN QUERY PLAN: every lookup and purge on analytics_dedupe uses the (day_bucket, message_id) PK (no SCAN)
    const plan = (sql: string, ...params: unknown[]) =>
      (db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((r) => r.detail).join(' | ');

    const { lookupBuckets } = resolveMessageBuckets(AT, Date.parse(AT));
    const bulkPlan = plan(BULK_UPSERT_DEDUPED, JSON.stringify([['video', 'v1', DAY, 'views', '', 1, 'hot-0', ...lookupBuckets]]));
    expect(bulkPlan).toMatch(/SEARCH analytics_dedupe USING PRIMARY KEY \(day_bucket=\? AND message_id=\?\)/);
    expect(bulkPlan).not.toMatch(/SCAN analytics_dedupe/);

    const boundedPlan = plan(
      BOUNDED_UPSERT_DEDUPED,
      'video',
      'v1',
      DAY,
      'source',
      'embed',
      10,
      'other',
      JSON.stringify([['hot-0', 1, ...lookupBuckets]]),
    );
    expect(boundedPlan).toMatch(/SEARCH analytics_dedupe USING PRIMARY KEY \(day_bucket=\? AND message_id=\?\)/);
    expect(boundedPlan).not.toMatch(/SCAN analytics_dedupe/);

    const dedupeInsertPlan = plan(DEDUPE_INSERT, JSON.stringify([[DAY, 'hot-0']]));
    expect(dedupeInsertPlan).not.toMatch(/SCAN analytics_dedupe/);

    const purgePlan = plan(
      'DELETE FROM analytics_dedupe WHERE (day_bucket, message_id) IN (SELECT day_bucket, message_id FROM analytics_dedupe WHERE day_bucket < ?1 ORDER BY day_bucket, message_id LIMIT ?2)',
      '2026-11-16',
      ANALYTICS_DEDUPE_PURGE_BATCH,
    );
    expect(purgePlan).toMatch(/SEARCH analytics_dedupe USING PRIMARY KEY \(day_bucket<\?\)/);
    expect(purgePlan).toMatch(/SEARCH analytics_dedupe USING PRIMARY KEY \(day_bucket=\? AND message_id=\?\)/);
    expect(purgePlan).not.toMatch(/SCAN analytics_dedupe/);
    expect(purgePlan).not.toMatch(/TEMP B-TREE/);
  });

  it('purges expired day buckets hourly in gentle 1,000-row PK chunks, reports backlog when capped, and finishes on the next run', async () => {
    expect(ANALYTICS_DEDUPE_PURGE_BATCH).toBe(1000);

    const db = createSqliteD1();
    const now = Date.parse('2026-11-24T12:00:00.000Z');
    const expiredDay = '2026-11-15'; // 9 days before 2026-11-24 (> 8-day TTL)
    const activeDay = '2026-11-23'; // 1 day before 2026-11-24

    // Seed 5 expired rows and 2 active rows
    const insert = db.raw.prepare('INSERT INTO analytics_dedupe (day_bucket, message_id) VALUES (?, ?)');
    for (let i = 0; i < 5; i++) insert.run(expiredDay, `old-${i}`);
    for (let i = 0; i < 2; i++) insert.run(activeDay, `fresh-${i}`);

    // Bounded run that hits maxRounds reports caughtUp: false and stops cleanly
    const partial = await purgeExpiredAnalyticsDedupe(db, now, { batchSize: 2, maxRounds: 2 });
    expect(partial).toMatchObject({ deleted: 4, rounds: 2, caughtUp: false, timedOut: false, cutoffDay: '2026-11-16' });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_dedupe WHERE day_bucket = ?').get(expiredDay)).toEqual({ n: 1 });

    // Next hourly run finishes the remaining expired row and keeps active rows untouched
    const finished = await runAnalyticsDedupePurge(makeEnv(db), now);
    expect(finished).toMatchObject({ deleted: 1, rounds: 1, caughtUp: true, timedOut: false });
    const remaining = db.raw.prepare('SELECT day_bucket, message_id FROM analytics_dedupe ORDER BY message_id').all();
    expect(remaining).toEqual([
      { day_bucket: activeDay, message_id: 'fresh-0' },
      { day_bucket: activeDay, message_id: 'fresh-1' },
    ]);

    // Time-box guard stops before exceeding wall-clock budget
    for (let i = 0; i < 4; i++) insert.run(expiredDay, `tb-${i}`);
    let t = 0;
    const timedOut = await purgeExpiredAnalyticsDedupe(db, now, {
      batchSize: 2,
      maxRounds: 10,
      timeBoxMs: 100,
      clock: () => {
        t += 150;
        return t;
      },
    });
    expect(timedOut).toMatchObject({ deleted: 2, rounds: 1, caughtUp: false, timedOut: true });

    // Wired into BOTH the hourly cron (ROLLUP_IMPORT_CRON) and the daily runScheduled cron
    const scheduledPromises: Promise<unknown>[] = [];
    await worker.scheduled({ cron: ROLLUP_IMPORT_CRON }, makeEnv(db), { waitUntil: (p) => scheduledPromises.push(p) });
    await Promise.all(scheduledPromises);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_dedupe WHERE day_bucket = ?').get(expiredDay)).toEqual({ n: 0 });

    insert.run(expiredDay, 'daily-expired');
    await runScheduled(makeEnv(db), now);
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_dedupe WHERE day_bucket = ?').get(expiredDay)).toEqual({ n: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM analytics_dedupe WHERE day_bucket = ?').get(activeDay)).toEqual({ n: 2 });
    expect(ANALYTICS_DEDUPE_TTL_MS).toBe(ANALYTICS_DEDUPE_TTL_DAYS * 86_400_000);
  });
});
