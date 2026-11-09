/**
 * Analytics rollups as D1 counters (SCALABILITY-AUDIT PR-1): events become
 * increments, increments are atomic upserts, and the legacy R2 documents are
 * imported exactly once. Runs the real SQL on node:sqlite.
 */
import {
  IMPORT_MIN_AGE_MS,
  MAX_EMBED_ORIGINS,
  importLegacyRollups,
  parseRollupKey,
  recordViewRollup,
  recordWatchTimeRollup,
  rollupKey,
  toUtcDay,
  viewDimensions,
  viewIncrements,
  watchTimeIncrements,
} from '../lib/analytics-rollup';
import { CounterBatch, OTHER_DIM, addCounters, readCounters } from '../lib/analytics-counters';
import type { R2Bucket } from '../types';
import { createSqliteD1 } from './sqlite-d1';

const pause = () => new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * 4)));

function total(db: ReturnType<typeof createSqliteD1>, where: string, ...params: unknown[]): number {
  const row = db.raw.prepare(`SELECT COALESCE(SUM(value), 0) AS n FROM analytics_daily WHERE ${where}`).get(...params);
  return Number(row?.n ?? 0);
}

function memoryBucket(objects: Record<string, { body: unknown; uploaded: Date }> = {}) {
  const store = new Map(Object.entries(objects).map(([k, v]) => [k, { body: JSON.stringify(v.body), uploaded: v.uploaded }]));
  const bucket = {
    store,
    deleteFails: false,
    put: jest.fn(async () => undefined),
    get: jest.fn(async (key: string) => {
      await pause();
      const o = store.get(key);
      if (!o) return null;
      return { key, json: async <T,>() => JSON.parse(o.body) as T, text: async () => o.body };
    }),
    list: jest.fn(async (opts: { prefix?: string; limit?: number; cursor?: string } = {}) => {
      const keys = [...store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
      const start = opts.cursor ? keys.indexOf(opts.cursor) + 1 : 0;
      const page = keys.slice(start, start + (opts.limit ?? 1000));
      const truncated = start + page.length < keys.length;
      return { objects: page.map((key) => ({ key, uploaded: store.get(key)!.uploaded })), truncated, cursor: truncated ? page[page.length - 1] : undefined };
    }),
    delete: jest.fn(async (key: string) => {
      await pause();
      if (bucket.deleteFails) throw new Error('R2 unavailable');
      store.delete(key);
    }),
  };
  return bucket;
}

describe('events → increments', () => {
  it('normalizes timestamps to UTC days and parses legacy keys', () => {
    expect(toUtcDay('2026-11-06T23:59:59.000Z')).toBe('2026-11-06');
    expect(toUtcDay(Date.UTC(2026, 0, 2, 3))).toBe('2026-01-02');
    expect(parseRollupKey(rollupKey('channel', 'c-1', '2026-11'))).toEqual({ entityType: 'channel', entityId: 'c-1', month: '2026-11' });
    expect(parseRollupKey('analytics/events/x.json')).toBeNull();
  });

  it('a tracked view counts for the video and its channel', () => {
    const incs = viewIncrements({ videoId: 'v1', videoChannelId: 'c1', watchTime: 12, timestamp: '2026-11-06T10:00:00.000Z' }, Date.now())!;
    expect(incs).toEqual(expect.arrayContaining([
      { entityType: 'video', entityId: 'v1', day: '2026-11-06', metric: 'views', value: 1 },
      { entityType: 'video', entityId: 'v1', day: '2026-11-06', metric: 'watch_time', value: 12 },
      { entityType: 'channel', entityId: 'c1', day: '2026-11-06', metric: 'views', value: 1 },
      { entityType: 'channel', entityId: 'c1', day: '2026-11-06', metric: 'watch_time', value: 12 },
    ]));
  });

  it('legacy videos without a channel count for the video only (prod payload shape)', () => {
    const incs = viewIncrements({ videoId: '0269b21b', videoChannelId: null, watchTime: 0, timestamp: '2026-11-08T05:49:26.147Z' }, Date.now())!;
    // An older client sends no traffic source: counted as unknown, so sources add up to views
    expect(incs).toEqual([
      { entityType: 'video', entityId: '0269b21b', day: '2026-11-08', metric: 'views', value: 1 },
      { entityType: 'video', entityId: '0269b21b', day: '2026-11-08', metric: 'traffic', dim: 'unknown', value: 1, maxDims: 13 },
    ]);
  });

  it('ignores view-like events that are not tracked views', () => {
    expect(viewIncrements({ videoId: 'v1' }, Date.now())).toBeNull();
    expect(viewIncrements({ searchQuery: 'x' } as never, Date.now())).toBeNull();
    expect(viewIncrements({ videoId: 'v1', source: 'embed' }, Date.now())).toBeNull();
    expect(viewIncrements({ videoId: 'v1', trackedView: true }, '2026-11-08T00:00:00Z')).not.toBeNull();
  });

  it('embed views carry the surface and the embedding origin (docs/embeds §6)', () => {
    expect(viewDimensions({ source: 'embed', embedOrigin: 'javascript:alert(1)' })).toEqual({ source: 'embed', embedOrigin: null });
    const incs = viewIncrements({ videoId: 'v1', trackedView: true, source: 'embed', embedOrigin: 'https://a.org', timestamp: '2026-11-08T10:00:00Z' }, Date.now())!;
    expect(incs).toEqual(expect.arrayContaining([
      { entityType: 'video', entityId: 'v1', day: '2026-11-08', metric: 'source', dim: 'embed', value: 1, maxDims: 10 },
      { entityType: 'video', entityId: 'v1', day: '2026-11-08', metric: 'embed_origin', dim: 'https://a.org', value: 1, maxDims: MAX_EMBED_ORIGINS },
    ]));
  });

  it('watch-time reports add capped seconds and never a view (#235)', () => {
    expect(watchTimeIncrements({ videoId: 'v1', videoChannelId: 'c1', seconds: 500, timestamp: '2026-11-06T10:00:00Z' }, Date.now())).toEqual([
      { entityType: 'video', entityId: 'v1', day: '2026-11-06', metric: 'watch_time', value: 60 },
      { entityType: 'channel', entityId: 'c1', day: '2026-11-06', metric: 'watch_time', value: 60 },
    ]);
    expect(watchTimeIncrements({ videoId: 'v1', seconds: 0 }, Date.now())).toBeNull();
    expect(watchTimeIncrements({ videoId: 'v1', seconds: 'x' }, Date.now())).toBeNull();
    expect(watchTimeIncrements({ seconds: 5 }, Date.now())).toBeNull();
  });
});

describe('D1 counters', () => {
  it('sums increments of one batch into one row per key', async () => {
    const db = createSqliteD1();
    const batch = new CounterBatch();
    for (let i = 0; i < 10; i++) recordViewRollup(batch, { videoId: 'v1', videoChannelId: 'c1', watchTime: 1.5, timestamp: '2026-11-06T10:00:00Z' }, 0);
    recordWatchTimeRollup(batch, { videoId: 'v1', videoChannelId: 'c1', seconds: 28.42, timestamp: '2026-11-06T10:00:00Z' }, 0);
    // views, watch_time and traffic for the video and for the channel
    expect(batch.size).toBe(6);
    await batch.flush(db);
    expect(batch.size).toBe(0);
    const rows = await readCounters(db, 'video', ['v1'], '2026-11-01', '2026-11-30');
    expect(rows.find((r) => r.metric === 'views')?.value).toBe(10);
    expect(rows.find((r) => r.metric === 'watch_time')?.value).toBeCloseTo(43.42);
    expect(total(db, "entity_type = 'channel' AND metric = 'views'")).toBe(10);
  });

  it('50 concurrent consumers × 40 views of one hot video lose no update', async () => {
    // Before: each consumer read the monthly document, added, and wrote it back;
    // concurrent isolates overwrote each other. Now every write is an upsert.
    const db = createSqliteD1();
    const consumers = Array.from({ length: 50 }, async (_, c) => {
      const batch = new CounterBatch();
      for (let i = 0; i < 40; i++) {
        await pause();
        recordViewRollup(batch, { videoId: 'hot', videoChannelId: 'ch', watchTime: 2, source: i % 2 ? 'embed' : 'watch', embedOrigin: `https://site${c}.org`, timestamp: '2026-11-06T10:00:00Z' }, 0);
        if (i % 4 === 0) recordWatchTimeRollup(batch, { videoId: 'hot', videoChannelId: 'ch', seconds: 10, timestamp: '2026-11-06T10:00:00Z' }, 0);
      }
      await pause();
      await batch.flush(db);
    });
    await Promise.all(consumers);
    for (const entity of ['video', 'channel']) {
      expect(total(db, "entity_type = ? AND metric = 'views'", entity)).toBe(2000);
      expect(total(db, "entity_type = ? AND metric = 'watch_time'", entity)).toBe(50 * (40 * 2 + 10 * 10));
      expect(total(db, "entity_type = ? AND metric = 'source'", entity)).toBe(2000);
      expect(total(db, "entity_type = ? AND metric = 'embed_origin'", entity)).toBe(1000);
    }
  });

  it('bounded dimensions stay under the cap with concurrent writers and keep every count', async () => {
    const db = createSqliteD1();
    await Promise.all(Array.from({ length: 80 }, async (_, i) => {
      await pause();
      await addCounters(db, [{ entityType: 'video', entityId: 'v1', day: '2026-11-06', metric: 'embed_origin', dim: `https://o${i}.org`, value: 2, maxDims: MAX_EMBED_ORIGINS }]);
    }));
    const rows = await readCounters(db, 'video', ['v1'], '2026-11-06', '2026-11-06', ['embed_origin']);
    const named = rows.filter((r) => r.dim !== OTHER_DIM);
    expect(named.length).toBe(MAX_EMBED_ORIGINS);
    expect(rows.find((r) => r.dim === OTHER_DIM)?.value).toBe(2 * (80 - MAX_EMBED_ORIGINS));
    expect(rows.reduce((a, r) => a + r.value, 0)).toBe(160);
    // An origin that already has a row keeps counting under its own name
    await addCounters(db, [{ entityType: 'video', entityId: 'v1', day: '2026-11-06', metric: 'embed_origin', dim: named[0].dim, value: 1, maxDims: MAX_EMBED_ORIGINS }]);
    expect(total(db, 'dim = ?', named[0].dim)).toBe(3);
  });

  it('a flush is one transaction: a failure writes nothing', async () => {
    const db = createSqliteD1();
    const batch = new CounterBatch();
    batch.add({ entityType: 'video', entityId: 'v1', day: '2026-11-06', metric: 'views', value: 1 });
    const failing = { ...db, batch: (statements: unknown[]) => db.batch([...(statements as never[]), db.prepare('INSERT INTO no_such_table VALUES (1)')]) };
    await expect(batch.flush(failing as never, 1)).rejects.toThrow();
    expect(total(db, '1 = 1')).toBe(0);
  });
});

describe('legacy R2 document import', () => {
  const now = Date.UTC(2026, 10, 9, 12);
  const old = new Date(now - IMPORT_MIN_AGE_MS - 1000);
  const doc = (days: Record<string, unknown>) => ({ entityType: 'video', entityId: 'v1', month: '2026-10', days });

  function legacyBucket() {
    return memoryBucket({
      [rollupKey('video', 'v1', '2026-10')]: { body: doc({ '2026-10-05': { views: 7, watchTime: 30.5, sources: { watch: 5, embed: 2 }, embedOrigins: { 'https://a.org': 2 } } }), uploaded: old },
      [rollupKey('channel', 'c1', '2026-10')]: { body: { ...doc({ '2026-10-05': { views: 7, watchTime: 30.5 } }), entityType: 'channel' }, uploaded: old },
      // Still written by an older processor version: left alone
      [rollupKey('video', 'v1', '2026-11')]: { body: doc({ '2026-11-09': { views: 1, watchTime: 0 } }), uploaded: new Date(now - 60_000) },
    });
  }

  it('moves old documents into D1 and deletes them; recent ones wait', async () => {
    const db = createSqliteD1();
    const bucket = legacyBucket();
    const result = await importLegacyRollups(bucket as unknown as R2Bucket, db, { now });
    expect(result).toMatchObject({ imported: 2, alreadyImported: 0, tooRecent: 1, failed: 0, more: false });
    expect(total(db, "entity_type = 'video' AND metric = 'views'")).toBe(7);
    expect(total(db, "entity_type = 'video' AND metric = 'watch_time'")).toBeCloseTo(30.5);
    expect(total(db, "metric = 'source' AND dim = 'embed'")).toBe(2);
    expect(total(db, "metric = 'embed_origin'")).toBe(2);
    expect(total(db, "entity_type = 'channel' AND metric = 'views'")).toBe(7);
    expect([...bucket.store.keys()]).toEqual([rollupKey('video', 'v1', '2026-11')]);
  });

  it('never imports a document twice, even when runs overlap or the delete fails', async () => {
    const db = createSqliteD1();
    const bucket = legacyBucket();
    bucket.deleteFails = true;
    const runs = await Promise.all(Array.from({ length: 5 }, () => importLegacyRollups(bucket as unknown as R2Bucket, db, { now })));
    expect(runs.reduce((a, r) => a + r.imported, 0)).toBe(2);
    expect(total(db, "entity_type = 'video' AND metric = 'views'")).toBe(7);
    // Later run once R2 works again: deletes without adding again
    bucket.deleteFails = false;
    const later = await importLegacyRollups(bucket as unknown as R2Bucket, db, { now });
    expect(later.alreadyImported).toBe(2);
    expect(total(db, "entity_type = 'video' AND metric = 'views'")).toBe(7);
    expect(bucket.store.size).toBe(1);
  });

  it('stops at its budget and reports that more remain', async () => {
    const db = createSqliteD1();
    const objects: Record<string, { body: unknown; uploaded: Date }> = {};
    for (let i = 0; i < 12; i++) objects[rollupKey('video', `v${i}`, '2026-09')] = { body: doc({ '2026-09-01': { views: 1, watchTime: 0 } }), uploaded: old };
    const bucket = memoryBucket(objects);
    const first = await importLegacyRollups(bucket as unknown as R2Bucket, db, { now, budget: 5 });
    expect(first).toMatchObject({ imported: 5, more: true });
    let rounds = 0;
    while ((await importLegacyRollups(bucket as unknown as R2Bucket, db, { now, budget: 5 })).more) rounds++;
    expect(rounds).toBeLessThan(5);
    expect(total(db, "metric = 'views'")).toBe(12);
    expect(bucket.store.size).toBe(0);
  });
});
