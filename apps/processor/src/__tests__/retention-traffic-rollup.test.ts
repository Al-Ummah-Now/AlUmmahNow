/**
 * Retention and traffic sources for Creator Studio (docs/specs/CREATOR-STUDIO.md §8.4),
 * as D1 daily counters (analytics-counters.ts). Runs the real SQL on node:sqlite.
 */
import {
  recordRetentionRollup,
  retentionIncrements,
  sanitizeRetentionBuckets,
  trafficDimensions,
  viewIncrements,
  MAX_EXTERNAL_HOSTS,
} from '../lib/analytics-rollup';
import { CounterBatch, OTHER_DIM, addCounters, readCounters } from '../lib/analytics-counters';
import { MessageType, RETENTION_BUCKET_COUNT, TRAFFIC_SOURCES, normalizeReferrerHost } from '@al-ummah/shared-types';
import { MessageProcessor } from '../messageProcessor';
import type { AlUmmahMessage, QueueEnvironment } from '../types';
import { createSqliteD1 } from './sqlite-d1';

const DAY = '2026-11-09';
const AT = `${DAY}T10:00:00.000Z`;
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as ConstructorParameters<typeof MessageProcessor>[0];

describe('shared collection constants', () => {
  it('has 20 retention buckets of 5%', () => {
    expect(RETENTION_BUCKET_COUNT).toBe(20);
  });

  it('lists every traffic source of the spec', () => {
    expect([...TRAFFIC_SOURCES].sort()).toEqual(
      ['channel', 'direct', 'embed', 'explore', 'external', 'home', 'library', 'notification', 'playlist', 'search', 'subscriptions', 'unknown', 'up_next'].sort()
    );
  });

  it('keeps only a valid lower-case host', () => {
    expect(normalizeReferrerHost('WWW.Example.org')).toBe('www.example.org');
    expect(normalizeReferrerHost('https://example.org/path?q=1')).toBeNull();
    expect(normalizeReferrerHost('example.org/path')).toBeNull();
    expect(normalizeReferrerHost('')).toBeNull();
    expect(normalizeReferrerHost(42)).toBeNull();
    expect(normalizeReferrerHost(`${'a'.repeat(254)}.org`)).toBeNull();
  });
});

describe('retention', () => {
  it('keeps valid buckets, once each, in order', () => {
    expect(sanitizeRetentionBuckets([3, 1, 3, 19, 0])).toEqual([0, 1, 3, 19]);
  });

  it('refuses a report with an invalid bucket or none', () => {
    for (const bad of [[], [20], [-1], [1.5], '1']) expect(sanitizeRetentionBuckets(bad)).toBeNull();
  });

  it('counts a start with bucket 0, and each bucket under its own dimension', () => {
    expect(retentionIncrements({ videoId: 'v1', buckets: [0, 2], timestamp: AT }, 0)).toEqual([
      { entityType: 'video', entityId: 'v1', day: DAY, metric: 'retention_start', value: 1 },
      { entityType: 'video', entityId: 'v1', day: DAY, metric: 'retention', dim: '0', value: 1 },
      { entityType: 'video', entityId: 'v1', day: DAY, metric: 'retention', dim: '2', value: 1 },
    ]);
    expect(retentionIncrements({ videoId: 'v1', buckets: [5], timestamp: AT }, 0)?.some((i) => i.metric === 'retention_start')).toBe(false);
  });

  it('refuses an invalid report', () => {
    expect(retentionIncrements({ videoId: 'v1', buckets: [99] }, 0)).toBeNull();
    expect(retentionIncrements({ buckets: [1] }, 0)).toBeNull();
  });

  it('adds up exactly across concurrent consumers, and stores no session id', async () => {
    const db = createSqliteD1();
    await Promise.all(Array.from({ length: 30 }, async (_, i) => {
      const batch = new CounterBatch();
      recordRetentionRollup(batch, { videoId: 'v1', buckets: [0, 1], sessionId: `s-${i}`, timestamp: AT }, 0);
      await batch.flush(db);
    }));
    const rows = await readCounters(db, 'video', ['v1'], DAY, DAY);
    expect(rows.find((r) => r.metric === 'retention_start')?.value).toBe(30);
    expect(rows.find((r) => r.metric === 'retention' && r.dim === '1')?.value).toBe(30);
    expect(JSON.stringify(rows)).not.toContain('s-1');
  });
});

describe('traffic sources', () => {
  it('reads a valid source and an external host only', () => {
    expect(trafficDimensions({ trafficSource: 'search', referrerHost: 'example.org' })).toEqual({ trafficSource: 'search' });
    expect(trafficDimensions({ trafficSource: 'external', referrerHost: 'Example.org' })).toEqual({ trafficSource: 'external', referrerHost: 'example.org' });
    expect(trafficDimensions({ trafficSource: 'external', referrerHost: 'https://a.org/x' })).toEqual({ trafficSource: 'external' });
  });

  it('treats a missing or invalid source as unknown, so sources add up to views', () => {
    expect(trafficDimensions({})).toEqual({ trafficSource: 'unknown' });
    expect(trafficDimensions({ trafficSource: 'bogus' })).toEqual({ trafficSource: 'unknown' });
  });

  it('counts the source and an external host for the video and its channel', () => {
    const incs = viewIncrements({ videoId: 'v1', videoChannelId: 'c1', trackedView: true, trafficSource: 'external', referrerHost: 'a.org', timestamp: AT }, 0)!;
    for (const entity of ['v1', 'c1']) {
      expect(incs).toEqual(expect.arrayContaining([
        expect.objectContaining({ entityId: entity, metric: 'traffic', dim: 'external', value: 1 }),
        expect.objectContaining({ entityId: entity, metric: 'external_host', dim: 'a.org', value: 1, maxDims: MAX_EXTERNAL_HOSTS }),
      ]));
    }
  });

  it('limits external hosts per day, the rest under other', async () => {
    const db = createSqliteD1();
    const increments = Array.from({ length: MAX_EXTERNAL_HOSTS + 3 }, (_, i) =>
      viewIncrements({ videoId: 'v1', videoChannelId: null, trackedView: true, trafficSource: 'external', referrerHost: `h${i}.org`, timestamp: AT }, 0)!
    ).flat();
    await addCounters(db, increments);
    const hosts = (await readCounters(db, 'video', ['v1'], DAY, DAY, ['external_host']));
    expect(hosts).toHaveLength(MAX_EXTERNAL_HOSTS + 1);
    expect(hosts.find((r) => r.dim === OTHER_DIM)?.value).toBe(3);
    const traffic = await readCounters(db, 'video', ['v1'], DAY, DAY, ['traffic']);
    expect(traffic).toEqual([expect.objectContaining({ dim: 'external', value: MAX_EXTERNAL_HOSTS + 3 })]);
  });
});

describe('MessageType.VideoRetention', () => {
  it('is consumed into the batch and written at flush', async () => {
    const db = createSqliteD1();
    const env = { NOTIFICATIONS_DB: db, MESSAGES_BUCKET: { put: jest.fn() } } as unknown as QueueEnvironment;
    const processor = new MessageProcessor(logger, undefined, { batchCounters: true });
    const message = { id: 'r-1', type: MessageType.VideoRetention, timestamp: Date.now(), payload: { videoId: 'v1', buckets: [0], sessionId: 's-1', timestamp: AT } } as AlUmmahMessage;
    expect((await processor.processMessage(message, env)).success).toBe(true);
    expect(await readCounters(db, 'video', ['v1'], DAY, DAY)).toHaveLength(0);
    await processor.flushCounters(env);
    expect((await readCounters(db, 'video', ['v1'], DAY, DAY)).length).toBeGreaterThan(0);
  });

  it('does not fail the message for an invalid report', async () => {
    const env = { NOTIFICATIONS_DB: createSqliteD1(), MESSAGES_BUCKET: { put: jest.fn() } } as unknown as QueueEnvironment;
    const message = { id: 'r-2', type: MessageType.VideoRetention, timestamp: Date.now(), payload: { videoId: 'v1', buckets: [99] } } as AlUmmahMessage;
    expect((await new MessageProcessor(logger).processMessage(message, env)).success).toBe(true);
  });
});
