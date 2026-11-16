import { CounterBatch, ENTITY_TYPES } from '../lib/analytics-counters';
import { MessageProcessor } from '../messageProcessor';
import { MessageType, type AlUmmahMessage, type QueueEnvironment } from '../types';
import { createSqliteD1 } from './sqlite-d1';
import { shortLinkIncrements, visitIncrements, SHORT_LINKS_ENTITY_ID, SITE_ENTITY_ID } from '../lib/site-visits';

describe('site visit counters (D-SEO-9)', () => {
  it('counts a visit, its landing kind, its source and the referrer host', () => {
    const rows = visitIncrements([{ landing: 'watch', source: 'search:google', referrerHost: 'www.google.com' }], '2026-11-13T10:00:00.000Z');
    expect(rows).toEqual([
      { entityType: 'site', entityId: SITE_ENTITY_ID, day: '2026-11-13', metric: 'visits', value: 1 },
      { entityType: 'site', entityId: SITE_ENTITY_ID, day: '2026-11-13', metric: 'landing', dim: 'watch', value: 1 },
      { entityType: 'site', entityId: SITE_ENTITY_ID, day: '2026-11-13', metric: 'source', dim: 'search:google', value: 1, maxDims: 60 },
      { entityType: 'site', entityId: SITE_ENTITY_ID, day: '2026-11-13', metric: 'referrer_host', dim: 'www.google.com', value: 1, maxDims: 100 },
    ]);
  });

  it('a direct visit has no referrer host', () => {
    const rows = visitIncrements([{ landing: 'home', source: 'direct' }], '2026-11-13T10:00:00.000Z');
    expect(rows.map((r) => r.metric)).toEqual(['visits', 'landing', 'source']);
  });

  it('drops anything off the allow-lists, and more than a handful of visits per batch', () => {
    expect(visitIncrements([{ landing: '/en/video/123', source: 'direct' }], '2026-11-13')).toEqual([]);
    expect(visitIncrements([{ landing: 'home', source: 'evil; DROP TABLE' }], '2026-11-13')).toEqual([]);
    expect(visitIncrements([{ landing: 'home', source: 'site', referrerHost: 'not a host' }], '2026-11-13').map((r) => r.metric)).toEqual(['visits', 'landing', 'source']);
    const many = Array.from({ length: 50 }, () => ({ landing: 'home', source: 'direct' }));
    expect(visitIncrements(many, '2026-11-13').filter((r) => r.metric === 'visits')).toHaveLength(5);
  });
});

describe('short link click counters (alummahnow.link)', () => {
  it('counts a click, its link type and its source, never an id', () => {
    const rows = shortLinkIncrements([{ type: 'video', source: 'social:whatsapp', id: 'abc' }], '2026-11-13T10:00:00.000Z');
    expect(rows).toEqual([
      { entityType: 'site', entityId: SHORT_LINKS_ENTITY_ID, day: '2026-11-13', metric: 'clicks', value: 1 },
      { entityType: 'site', entityId: SHORT_LINKS_ENTITY_ID, day: '2026-11-13', metric: 'type', dim: 'video', value: 1 },
      { entityType: 'site', entityId: SHORT_LINKS_ENTITY_ID, day: '2026-11-13', metric: 'source', dim: 'social:whatsapp', value: 1, maxDims: 60 },
    ]);
    expect(JSON.stringify(rows)).not.toContain('abc');
  });

  it('drops unknown types and sources, and more than a handful per batch', () => {
    expect(shortLinkIncrements([{ type: 'secret', source: 'direct' }], '2026-11-13')).toEqual([]);
    expect(shortLinkIncrements([{ type: 'video', source: 'https://x' }], '2026-11-13')).toEqual([]);
    const many = Array.from({ length: 50 }, () => ({ type: 'home', source: 'direct' }));
    expect(shortLinkIncrements(many, '2026-11-13').filter((r) => r.metric === 'clicks')).toHaveLength(5);
  });
});

describe('site counters reach D1 through the processor', () => {
  // The admin Site visits page read nothing: CounterBatch only took video/channel/post rows and
  // silently dropped every 'site' increment (visits and short link clicks) before the write.
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;
  const message = (id: string, kind: string, events: unknown[]): AlUmmahMessage =>
    ({ id, type: MessageType.ClientAnalyticsEvent, timestamp: '2026-11-15T10:00:00.000Z', payload: { kind, events, receivedAt: '2026-11-15T10:00:00.000Z' } }) as never;

  it('writes visits and short link clicks to analytics_daily, one batch per queue batch', async () => {
    const db = createSqliteD1();
    const env = { NOTIFICATIONS_DB: db, MESSAGE_ARCHIVE: 'off' } as unknown as QueueEnvironment;
    const processor = new MessageProcessor(logger, undefined, { batchCounters: true });
    for (const m of [
      message('v1', 'visit', [{ landing: 'watch', source: 'search:google', referrerHost: 'www.google.com' }]),
      message('v2', 'visit', [{ landing: 'home', source: 'direct' }]),
      message('s1', 'short_link', [{ type: 'video', source: 'social:whatsapp' }]),
    ]) {
      expect((await processor.processMessage(m, env)).success).toBe(true);
    }
    await processor.flushCounters(env);
    const rows = db.raw
      .prepare(`SELECT entity_id, metric, dim, value FROM analytics_daily WHERE entity_type = 'site' AND day = '2026-11-15' ORDER BY entity_id, metric, dim`)
      .all();
    expect(rows).toEqual([
      { entity_id: SHORT_LINKS_ENTITY_ID, metric: 'clicks', dim: '', value: 1 },
      { entity_id: SHORT_LINKS_ENTITY_ID, metric: 'source', dim: 'social:whatsapp', value: 1 },
      { entity_id: SHORT_LINKS_ENTITY_ID, metric: 'type', dim: 'video', value: 1 },
      { entity_id: SITE_ENTITY_ID, metric: 'landing', dim: 'home', value: 1 },
      { entity_id: SITE_ENTITY_ID, metric: 'landing', dim: 'watch', value: 1 },
      { entity_id: SITE_ENTITY_ID, metric: 'referrer_host', dim: 'www.google.com', value: 1 },
      { entity_id: SITE_ENTITY_ID, metric: 'source', dim: 'direct', value: 1 },
      { entity_id: SITE_ENTITY_ID, metric: 'source', dim: 'search:google', value: 1 },
      { entity_id: SITE_ENTITY_ID, metric: 'visits', dim: '', value: 2 },
    ]);
  });

  it('CounterBatch takes every entity type and still rejects unknown ones', () => {
    const batch = new CounterBatch();
    for (const entityType of ENTITY_TYPES) batch.add({ entityType, entityId: 'x', day: '2026-11-15', metric: 'm', value: 1 });
    batch.add({ entityType: 'user' as never, entityId: 'x', day: '2026-11-15', metric: 'm', value: 1 });
    expect(batch.size).toBe(ENTITY_TYPES.length);
  });
});
