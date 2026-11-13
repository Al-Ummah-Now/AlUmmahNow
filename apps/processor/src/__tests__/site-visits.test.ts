import { visitIncrements, SITE_ENTITY_ID } from '../lib/site-visits';

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
