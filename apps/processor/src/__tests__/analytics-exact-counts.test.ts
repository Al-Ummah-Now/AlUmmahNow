/**
 * Exactly-once analytics counters (#1921):
 * - A failed D1 flush never acknowledges counter-bearing messages; they are retried
 *   with bounded backoff and routed to the DLQ after max_retries.
 * - Per-message dedupe markers (analytics_dedupe, migration 0023) commit in the same
 *   D1 batch transaction as the analytics_daily upserts, so redeliveries and
 *   duplicates are no-ops and failed flushes roll back cleanly.
 * - No full-table scans on lookup or TTL purge; merged writes keep rows written low.
 *
 * Runs the real SQL on node:sqlite.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@al-ummah/logger';
import worker, {
  ANALYTICS_FLUSH_RETRY_DELAYS_SECONDS,
  VIDEOS_MAX_RETRIES,
  analyticsFlushRetryDelaySeconds,
  runScheduled,
} from '../index';
import { MessageProcessor } from '../messageProcessor';
import {
  ANALYTICS_DEDUPE_PURGE_BATCH,
  ANALYTICS_DEDUPE_TTL_MS,
  BOUNDED_UPSERT_DEDUPED,
  BULK_UPSERT_DEDUPED,
  CounterBatch,
  DEDUPE_INSERT,
  purgeExpiredAnalyticsDedupe,
  readCounters,
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

  it('a duplicate delivery (across batches and within the same batch) counts once', async () => {
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
  });

  it('a partial batch failure (per-message failure and mixed-batch flush failure) counts each message exactly once', async () => {
    const db = createSqliteD1();

    // Case 1: One message in a batch fails before counter recording (R2 archive error),
    // while the other messages succeed and flush. Then the failed message is redelivered
    // alongside a duplicate of an already-counted message and a brand-new message.
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

  it('retries with bounded backoff, routes to DLQ after max_retries, and a DLQ replay counts once', async () => {
    // Verify retry schedule matches wrangler max_retries
    expect(analyticsFlushRetryDelaySeconds(1)).toBe(ANALYTICS_FLUSH_RETRY_DELAYS_SECONDS[0]);
    expect(analyticsFlushRetryDelaySeconds(2)).toBe(ANALYTICS_FLUSH_RETRY_DELAYS_SECONDS[1]);
    expect(analyticsFlushRetryDelaySeconds(3)).toBe(ANALYTICS_FLUSH_RETRY_DELAYS_SECONDS[2]);
    expect(analyticsFlushRetryDelaySeconds(VIDEOS_MAX_RETRIES + 1)).toBeUndefined();

    // Verify wrangler configs bound retries and wire the DLQ on al-ummah-now-videos
    for (const file of ['wrangler.jsonc', 'wrangler.qa.jsonc']) {
      const text = readFileSync(join(__dirname, '..', '..', file), 'utf8');
      expect(text).toMatch(/"queue":\s*"al-ummah-now-videos[\s\S]*?"max_retries":\s*3[\s\S]*?"dead_letter_queue":\s*"al-ummah-now-dlq/);
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
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq', messages: [dlqDelivery] }, { NOTIFICATIONS_DB: db, ENVIRONMENT: 'test' }, logger, 1000);
    expect(dlqDelivery.ack).toHaveBeenCalled();

    const replayed: AlUmmahMessage[] = [];
    const outcome = await replayDeadLetter(db, { send: async (m) => { replayed.push(m); } }, 'dlq-1', 2000);
    expect(outcome).toEqual({ status: 'replayed', messageId: 'dlq-v-1' });
    expect(replayed).toHaveLength(1);

    const healthyEnv = makeEnv(db);
    await worker.queue({ queue: 'al-ummah-now-videos', messages: [qMsg(replayed[0])] } as never, healthyEnv);
    await worker.queue({ queue: 'al-ummah-now-videos', messages: [qMsg(replayed[0])] } as never, healthyEnv);
    expect(metricValue(db, 'video', 'v1', 'views')).toBe(1);
  });

  it('merges hot-batch increments into one counter row per key and uses indexed queries with no scans', async () => {
    const db = createSqliteD1();
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

    // EXPLAIN QUERY PLAN: every lookup on analytics_dedupe uses PK or idx_analytics_dedupe_expires (no SCAN)
    const plan = (sql: string, ...params: unknown[]) =>
      (db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((r) => r.detail).join(' | ');

    const bulkPlan = plan(BULK_UPSERT_DEDUPED, JSON.stringify([['video', 'v1', DAY, 'views', '', 1, 'hot-0']]));
    expect(bulkPlan).toMatch(/SEARCH analytics_dedupe USING PRIMARY KEY/);
    expect(bulkPlan).not.toMatch(/SCAN analytics_dedupe/);

    const boundedPlan = plan(BOUNDED_UPSERT_DEDUPED, 'video', 'v1', DAY, 'source', 'embed', 10, 'other', JSON.stringify([['hot-0', 1]]));
    expect(boundedPlan).toMatch(/SEARCH analytics_dedupe USING PRIMARY KEY/);
    expect(boundedPlan).not.toMatch(/SCAN analytics_dedupe/);

    const dedupeInsertPlan = plan(DEDUPE_INSERT, JSON.stringify(['hot-0']), 9999);
    expect(dedupeInsertPlan).not.toMatch(/SCAN analytics_dedupe/);

    const purgePlan = plan(
      'DELETE FROM analytics_dedupe WHERE message_id IN (SELECT message_id FROM analytics_dedupe WHERE expires_at < ?1 ORDER BY expires_at LIMIT ?2)',
      9999,
      ANALYTICS_DEDUPE_PURGE_BATCH,
    );
    expect(purgePlan).toMatch(/idx_analytics_dedupe_expires/);
    expect(purgePlan).not.toMatch(/SCAN analytics_dedupe(?! USING)/);
    expect(purgePlan).not.toMatch(/TEMP B-TREE/);
  });

  it('purges expired analytics_dedupe markers in bounded batches on the daily cron', async () => {
    const db = createSqliteD1();
    const now = 1_900_000_000_000;

    // Seed via CounterBatch with explicit timestamps: one expired, one active
    const b1 = new CounterBatch();
    b1.addForMessage('old-msg', [{ entityType: 'video', entityId: 'v1', day: DAY, metric: 'views', value: 1 }]);
    await b1.flush(db, 1, { now: now - ANALYTICS_DEDUPE_TTL_MS - 1000 });

    const b2 = new CounterBatch();
    b2.addForMessage('fresh-msg', [{ entityType: 'video', entityId: 'v1', day: DAY, metric: 'views', value: 1 }]);
    await b2.flush(db, 1, { now: now - 1000 });

    expect(await purgeExpiredAnalyticsDedupe(db, now)).toBe(1);
    const remaining = db.raw.prepare('SELECT message_id FROM analytics_dedupe').all() as { message_id: string }[];
    expect(remaining).toEqual([{ message_id: 'fresh-msg' }]);

    // Also wired into runScheduled
    const b3 = new CounterBatch();
    b3.addForMessage('expired-cron', [{ entityType: 'video', entityId: 'v1', day: DAY, metric: 'views', value: 1 }]);
    await b3.flush(db, 1, { now: now - ANALYTICS_DEDUPE_TTL_MS - 5000 });

    await runScheduled(makeEnv(db), now);
    const afterCron = db.raw.prepare('SELECT message_id FROM analytics_dedupe').all() as { message_id: string }[];
    expect(afterCron).toEqual([{ message_id: 'fresh-msg' }]);
  });
});
