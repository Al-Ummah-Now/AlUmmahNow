import { applyView, applyWatchTime, recordViewRollup, recordWatchTimeRollup, rollupKey, toUtcDay, MonthlyRollup } from '../lib/analytics-rollup';
import type { R2Bucket } from '../types';

function memoryBucket(): R2Bucket & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    put: jest.fn(async (key: string, value: unknown) => {
      store.set(key, String(value));
    }),
    get: jest.fn(async (key: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      return {
        key,
        body: undefined as unknown as ReadableStream,
        bodyUsed: false,
        json: async <T,>() => JSON.parse(value) as T,
        text: async () => value,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }),
    list: jest.fn(async () => ({ objects: [], truncated: false })),
  } as unknown as R2Bucket & { store: Map<string, string> };
}

describe('analytics rollups', () => {
  it('builds keys per entity and month', () => {
    expect(rollupKey('video', 'v1', '2026-11')).toBe('analytics/rollups/video/v1/2026-11.json');
  });

  it('normalizes timestamps to UTC days', () => {
    expect(toUtcDay('2026-11-06T23:59:59.000Z')).toBe('2026-11-06');
    expect(toUtcDay(Date.UTC(2026, 0, 2, 3))).toBe('2026-01-02');
  });

  it('accumulates views and watch time per day', () => {
    let doc: MonthlyRollup | null = null;
    doc = applyView(doc, 'video', 'v1', '2026-11-06', 30);
    doc = applyView(doc, 'video', 'v1', '2026-11-06', 15.5);
    doc = applyView(doc, 'video', 'v1', '2026-11-07', -5);
    expect(doc.days['2026-11-06']).toEqual({ views: 2, watchTime: 45.5 });
    expect(doc.days['2026-11-07']).toEqual({ views: 1, watchTime: 0 });
    expect(doc.month).toBe('2026-11');
  });

  it('starts a fresh document when the month changes', () => {
    const october = applyView(null, 'video', 'v1', '2026-10-31', 10);
    const november = applyView(october, 'video', 'v1', '2026-11-01', 10);
    expect(Object.keys(november.days)).toEqual(['2026-11-01']);
  });

  it('records video and channel rollups for tracked views', async () => {
    const bucket = memoryBucket();
    const ok = await recordViewRollup(bucket, {
      videoId: 'v1',
      videoChannelId: 'c1',
      watchTime: 12,
      timestamp: '2026-11-06T10:00:00.000Z',
    }, Date.now());
    expect(ok).toBe(true);
    const video = JSON.parse(bucket.store.get('analytics/rollups/video/v1/2026-11.json')!);
    const channel = JSON.parse(bucket.store.get('analytics/rollups/channel/c1/2026-11.json')!);
    expect(video.days['2026-11-06']).toEqual({ views: 1, watchTime: 12 });
    expect(channel.days['2026-11-06']).toEqual({ views: 1, watchTime: 12 });
  });

  it('records the video rollup for legacy videos without a channel (prod payload shape)', async () => {
    const bucket = memoryBucket();
    // Shape of a real prod VideoView message for an imported video (channelId null)
    const ok = await recordViewRollup(bucket, {
      videoId: '0269b21b',
      videoChannelId: null,
      watchTime: 0,
      timestamp: '2026-11-08T05:49:26.147Z',
    }, Date.now());
    expect(ok).toBe(true);
    expect(JSON.parse(bucket.store.get('analytics/rollups/video/0269b21b/2026-11.json')!).days['2026-11-08'])
      .toEqual({ views: 1, watchTime: 0 });
    expect([...bucket.store.keys()].some((k) => k.includes('/channel/'))).toBe(false);
  });

  it('accepts the explicit trackedView marker', async () => {
    const bucket = memoryBucket();
    expect(await recordViewRollup(bucket, { videoId: 'v1', trackedView: true }, '2026-11-08T00:00:00Z')).toBe(true);
    expect(bucket.store.has('analytics/rollups/video/v1/2026-11.json')).toBe(true);
  });

  it('ignores view-like events that are not tracked views', async () => {
    const bucket = memoryBucket();
    expect(await recordViewRollup(bucket, { videoId: 'v1' }, Date.now())).toBe(false);
    expect(await recordViewRollup(bucket, { searchQuery: 'x' } as never, Date.now())).toBe(false);
    expect(bucket.store.size).toBe(0);
  });

  it('skips buckets without read support', async () => {
    const putOnly = { put: jest.fn() } as unknown as R2Bucket;
    expect(await recordViewRollup(putOnly, { videoId: 'v1', videoChannelId: 'c1' }, Date.now())).toBe(false);
    expect(putOnly.put).not.toHaveBeenCalled();
  });
});

describe('watch-time rollups (#235)', () => {
  it('adds played seconds without counting a view, capped at 60 per report', () => {
    let doc: MonthlyRollup | null = applyView(null, 'video', 'v1', '2026-11-06', 0);
    doc = applyWatchTime(doc, 'video', 'v1', '2026-11-06', 30);
    doc = applyWatchTime(doc, 'video', 'v1', '2026-11-06', 12.345);
    doc = applyWatchTime(doc, 'video', 'v1', '2026-11-06', 500);
    doc = applyWatchTime(doc, 'video', 'v1', '2026-11-06', -3);
    expect(doc.days['2026-11-06']).toEqual({ views: 1, watchTime: 102.35 });
  });

  it('writes the video and channel rollups for a report', async () => {
    const bucket = memoryBucket();
    const ok = await recordWatchTimeRollup(bucket, { videoId: 'v1', videoChannelId: 'c1', seconds: 25, timestamp: '2026-11-06T10:00:00.000Z' }, Date.now());
    expect(ok).toBe(true);
    const video = JSON.parse(bucket.store.get('analytics/rollups/video/v1/2026-11.json')!) as MonthlyRollup;
    const channel = JSON.parse(bucket.store.get('analytics/rollups/channel/c1/2026-11.json')!) as MonthlyRollup;
    expect(video.days['2026-11-06']).toEqual({ views: 0, watchTime: 25 });
    expect(channel.days['2026-11-06']).toEqual({ views: 0, watchTime: 25 });
  });

  it('writes only the video rollup for legacy videos without a channel', async () => {
    const bucket = memoryBucket();
    expect(await recordWatchTimeRollup(bucket, { videoId: 'v1', videoChannelId: null, seconds: 5, timestamp: '2026-11-06T10:00:00.000Z' }, Date.now())).toBe(true);
    expect([...bucket.store.keys()]).toEqual(['analytics/rollups/video/v1/2026-11.json']);
  });

  it('ignores invalid reports', async () => {
    const bucket = memoryBucket();
    expect(await recordWatchTimeRollup(bucket, { videoId: 'v1', seconds: 0 }, Date.now())).toBe(false);
    expect(await recordWatchTimeRollup(bucket, { videoId: 'v1', seconds: 'x' }, Date.now())).toBe(false);
    expect(await recordWatchTimeRollup(bucket, { seconds: 5 }, Date.now())).toBe(false);
    expect(bucket.store.size).toBe(0);
  });
});
