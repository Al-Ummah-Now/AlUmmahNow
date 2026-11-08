/**
 * Embed view dimensions in the daily rollups (docs/embeds/README.md §6).
 */
import {
  applyView,
  applyWatchTime,
  incrementBounded,
  MAX_EMBED_ORIGINS,
  MonthlyRollup,
  recordViewRollup,
  viewDimensions,
} from '../lib/analytics-rollup';
import type { R2Bucket } from '../types';

function memoryBucket(initial: Record<string, unknown> = {}): R2Bucket & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    store,
    put: jest.fn(async (key: string, value: unknown) => {
      store.set(key, String(value));
    }),
    get: jest.fn(async (key: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      return { key, json: async <T,>() => JSON.parse(value) as T, text: async () => value };
    }),
    list: jest.fn(async () => ({ objects: [], truncated: false })),
  } as unknown as R2Bucket & { store: Map<string, string> };
}

describe('viewDimensions', () => {
  it('reads embed views with their origin', () => {
    expect(viewDimensions({ source: 'embed', embedOrigin: 'https://www.alummahnow.net' }))
      .toEqual({ source: 'embed', embedOrigin: 'https://www.alummahnow.net' });
  });
  it('drops malformed origins (paths, other schemes)', () => {
    expect(viewDimensions({ source: 'embed', embedOrigin: 'https://example.org/page' })).toEqual({ source: 'embed', embedOrigin: null });
    expect(viewDimensions({ source: 'embed', embedOrigin: 'javascript:x' })).toEqual({ source: 'embed', embedOrigin: null });
  });
  it('treats views without a source (sent before embeds) as no breakdown', () => {
    expect(viewDimensions({})).toEqual({});
    expect(viewDimensions({ source: 'bogus' })).toEqual({});
    expect(viewDimensions({ source: 'watch', embedOrigin: 'https://x.org' })).toEqual({ source: 'watch' });
  });
});

describe('incrementBounded', () => {
  it('folds keys past the bound into "other"', () => {
    let map: Record<string, number> | undefined;
    for (let i = 0; i < 3; i++) map = incrementBounded(map, `k${i}`, 2);
    map = incrementBounded(map, 'k0', 2);
    expect(map).toEqual({ k0: 2, k1: 1, other: 1 });
  });
});

describe('applyView with dimensions', () => {
  it('counts sources and embed origins per day', () => {
    let doc: MonthlyRollup | null = null;
    doc = applyView(doc, 'video', 'v1', '2026-11-08', 0, { source: 'watch' });
    doc = applyView(doc, 'video', 'v1', '2026-11-08', 0, { source: 'embed', embedOrigin: 'https://a.org' });
    doc = applyView(doc, 'video', 'v1', '2026-11-08', 0, { source: 'embed', embedOrigin: 'https://a.org' });
    doc = applyView(doc, 'video', 'v1', '2026-11-08', 0, { source: 'embed', embedOrigin: null });
    expect(doc.days['2026-11-08']).toEqual({
      views: 4,
      watchTime: 0,
      sources: { watch: 1, embed: 3 },
      embedOrigins: { 'https://a.org': 2, unknown: 1 },
    });
  });

  it('keeps old entries without breakdown valid and adds to them', () => {
    const old: MonthlyRollup = { entityType: 'video', entityId: 'v1', month: '2026-11', days: { '2026-11-08': { views: 5, watchTime: 10 } } };
    const doc = applyView(old, 'video', 'v1', '2026-11-08', 0, { source: 'embed', embedOrigin: 'https://a.org' });
    expect(doc.days['2026-11-08']).toEqual({ views: 6, watchTime: 10, sources: { embed: 1 }, embedOrigins: { 'https://a.org': 1 } });
    const plain = applyView(old, 'video', 'v1', '2026-11-08', 0);
    expect(plain.days['2026-11-08']).toEqual({ views: 6, watchTime: 10 });
  });

  it(`bounds embed origins at ${MAX_EMBED_ORIGINS} per day`, () => {
    let doc: MonthlyRollup | null = null;
    for (let i = 0; i < MAX_EMBED_ORIGINS + 5; i++) {
      doc = applyView(doc, 'video', 'v1', '2026-11-08', 0, { source: 'embed', embedOrigin: `https://s${i}.org` });
    }
    const origins = doc!.days['2026-11-08'].embedOrigins!;
    expect(Object.keys(origins)).toHaveLength(MAX_EMBED_ORIGINS + 1);
    expect(origins.other).toBe(5);
  });
});

describe('applyWatchTime after embed views', () => {
  it('adds seconds without dropping the day\'s source breakdown', () => {
    let doc: MonthlyRollup | null = applyView(null, 'video', 'v1', '2026-11-08', 0, { source: 'embed', embedOrigin: 'https://a.org' });
    doc = applyWatchTime(doc, 'video', 'v1', '2026-11-08', 30);
    expect(doc.days['2026-11-08']).toEqual({
      views: 1,
      watchTime: 30,
      sources: { embed: 1 },
      embedOrigins: { 'https://a.org': 1 },
    });
  });
});

describe('recordViewRollup with an embed view', () => {
  it('writes the breakdown to the video and channel documents', async () => {
    const bucket = memoryBucket();
    const ok = await recordViewRollup(bucket, {
      videoId: 'v1',
      videoChannelId: 'c1',
      trackedView: true,
      source: 'embed',
      embedOrigin: 'https://www.alummahnow.net',
      timestamp: '2026-11-08T10:00:00.000Z',
    }, Date.now());
    expect(ok).toBe(true);
    for (const key of ['analytics/rollups/video/v1/2026-11.json', 'analytics/rollups/channel/c1/2026-11.json']) {
      const doc = JSON.parse(bucket.store.get(key)!) as MonthlyRollup;
      expect(doc.days['2026-11-08'].sources).toEqual({ embed: 1 });
      expect(doc.days['2026-11-08'].embedOrigins).toEqual({ 'https://www.alummahnow.net': 1 });
    }
  });

  it('ignores fetch telemetry (not a tracked view) even if it claims a source', async () => {
    const bucket = memoryBucket();
    expect(await recordViewRollup(bucket, { videoId: 'v1', source: 'embed' }, Date.now())).toBe(false);
    expect(bucket.store.size).toBe(0);
  });
});
