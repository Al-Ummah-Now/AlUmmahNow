import { buildPoolVideos, isTestComment, routeDemoRequest, type DemoPool, type DemoRequest, type DemoSet } from '../demo-filter';
import { apiPathOf, createDemoFetch } from '../demo-fetch';

const set: DemoSet = {
  channels: ['ch1', 'ch2'],
  videos: ['v1', 'v2', 'v3', 'keep'],
  shorts: ['v3'],
  extraVideos: ['keep'],
  playlists: ['p1'],
};

const pool: DemoPool = {
  videos: [
    { id: 'v2', title: 'Sea waves', channelId: 'ch2', category: 'nature', views: 9, dateCreated: '2026-02-01' },
    { id: 'v1', title: 'Blue Mosque', channelId: 'ch1', category: 'ramadan', views: 1, dateCreated: '2026-01-01' },
    { id: 'v3', title: 'Adhan short', channelId: 'ch1', category: 'ramadan', views: 5, dateCreated: '2025-12-01' },
  ],
  channels: [{ id: 'ch1', name: 'Mosques' }, { id: 'ch2', name: 'Nature' }],
};

const req = (pathname: string, query = '', over: Partial<DemoRequest> = {}): DemoRequest => ({
  method: 'GET',
  pathname,
  search: new URLSearchParams(query),
  authenticated: false,
  channelHeader: false,
  ...over,
});

function replaced(request: DemoRequest): Record<string, any> {
  const route = routeDemoRequest(set, request);
  if (route.kind !== 'replace') throw new Error(`expected replace, got ${route.kind}`);
  return route.respond(pool) as Record<string, any>;
}

function filtered(request: DemoRequest, body: unknown): Record<string, any> {
  const route = routeDemoRequest(set, request);
  if (route.kind !== 'filter') throw new Error(`expected filter, got ${route.kind}`);
  return route.transform(body, pool) as Record<string, any>;
}

describe('isTestComment', () => {
  it.each(['ws probe 1794', 'release live comment 179', 'E2E comment', 'hello [qa-seed]', 'a test comment'])('flags %s', (text) => {
    expect(isTestComment(text)).toBe(true);
  });
  it.each(['ما شاء الله', 'Beautiful recitation', 'I tested my patience', undefined])('keeps %s', (text) => {
    expect(isTestComment(text)).toBe(false);
  });
});

describe('buildPoolVideos', () => {
  it('merges channels, drops anything off the allow-list, de-duplicates and sorts newest first', () => {
    const merged = buildPoolVideos(set, [
      [{ id: 'v1', dateCreated: '2026-01-01' }, { id: 'junk', dateCreated: '2027-01-01' }],
      [{ id: 'v2', dateCreated: '2026-02-01' }, { id: 'v1', dateCreated: '2026-01-01' }],
    ]);
    expect(merged.map((v) => v.id)).toEqual(['v2', 'v1']);
  });
});

describe('routeDemoRequest', () => {
  it('leaves everything alone until the demo is seeded', () => {
    expect(routeDemoRequest({ ...set, videos: [] }, req('/api/videos')).kind).toBe('none');
  });

  it('never touches writes', () => {
    expect(routeDemoRequest(set, req('/api/videos', '', { method: 'POST' })).kind).toBe('none');
  });

  it('serves the home feed from the pool with stable pagination', () => {
    const first = replaced(req('/api/videos', 'limit=2'));
    expect(first.data.map((v: { id: string }) => v.id)).toEqual(['v2', 'v1']);
    expect(first.cursor).toBe('demo-2');
    const second = replaced(req('/api/videos', 'limit=2&cursor=demo-2'));
    expect(second.data.map((v: { id: string }) => v.id)).toEqual(['v3']);
    expect(second.cursor).toBe('');
  });

  it('honours the category filter and popularity sort', () => {
    expect(replaced(req('/api/videos', 'category=nature')).data).toHaveLength(1);
    expect(replaced(req('/api/videos', 'sortBy=views')).data[0].id).toBe('v2');
  });

  it('leaves owner views alone', () => {
    expect(routeDemoRequest(set, req('/api/videos', '', { channelHeader: true })).kind).toBe('none');
  });

  it('allow-lists a channelId listing', () => {
    expect(filtered(req('/api/videos', 'channelId=other'), { data: [{ id: 'junk' }, { id: 'v1' }] }).data).toEqual([{ id: 'v1' }]);
  });

  it('searches the demo channels and videos only and returns the search contract', () => {
    const body = replaced(req('/api/search', 'q=mosque'));
    expect(body.results.map((r: { id: string }) => r.id)).toEqual(['ch1', 'v1']);
    expect(body).toMatchObject({ success: true, hasMore: false, nextCursor: null });
    expect(replaced(req('/api/search', 'q=mosques&type=channel')).results[0].id).toBe('ch1');
  });

  it('separates the channel Videos and Shorts shelves by orientation, not duration', () => {
    expect(replaced(req('/api/channels/ch1/videos')).data.map((v: { id: string }) => v.id)).toEqual(['v1']);
    expect(replaced(req('/api/channels/ch1/shorts')).data.map((v: { id: string }) => v.id)).toEqual(['v3']);
    expect(replaced(req('/api/channels/stranger/videos')).data).toEqual([]);
  });

  it('builds related from the pool: never the current video or a short, same channel first', () => {
    const body = replaced(req('/api/recommendations', 'videoId=v2&limit=5'));
    expect(body.data.map((v: { id: string }) => v.id)).toEqual(['v1']);
    expect(body.videos).toEqual(body.data);
  });

  it('ranks trending by views', () => {
    expect(replaced(req('/api/trending')).data.map((v: { id: string }) => v.id)).toEqual(['v2', 'v3', 'v1']);
  });

  it('filters subscriptions feed, history, playlists and public channel lists', () => {
    expect(filtered(req('/api/profile/subscriptions/feed'), { data: [{ id: 'junk' }, { id: 'v2' }] }).data).toEqual([{ id: 'v2' }]);
    expect(filtered(req('/api/watch-history'), { entries: [{ videoId: 'junk' }, { videoId: 'v1' }] }).entries).toEqual([{ videoId: 'v1' }]);
    expect(filtered(req('/api/channels/ch1/playlists'), { data: [{ id: 'p1' }, { id: 'p9' }] }).data).toEqual([{ id: 'p1' }]);
    expect(filtered(req('/api/channels'), { data: [{ id: 'ch2' }, { id: 'e2e' }] }).data).toEqual([{ id: 'ch2' }]);
  });

  it("does not hide a signed-in user's own channels", () => {
    expect(routeDemoRequest(set, req('/api/channels', '', { authenticated: true })).kind).toBe('none');
  });

  it('rewrites explore to demo channels and real category counts', () => {
    const body = filtered(req('/api/explore'), {
      categories: [{ value: 'ramadan', count: 0 }, { value: 'fiqh', count: 7 }],
      newChannels: [{ id: 'e2e' }],
      seasonal: [{ id: 'x' }],
    });
    expect(body.newChannels).toEqual(pool.channels);
    expect(body.categories).toEqual([{ value: 'ramadan', count: 2 }, { value: 'fiqh', count: 0 }]);
    expect(body.seasonal).toEqual([]);
  });

  it('hides test comments and corrects the total', () => {
    const body = filtered(req('/api/videos/v1/comments'), {
      success: true,
      result: { comments: [{ text: 'ws probe 1' }, { text: 'ما شاء الله' }], total: 2 },
    });
    expect(body.result.comments).toEqual([{ text: 'ما شاء الله' }]);
    expect(body.result.total).toBe(1);
  });

  it('passes unrelated endpoints through', () => {
    expect(routeDemoRequest(set, req('/api/videos/v1')).kind).toBe('none');
    expect(routeDemoRequest(set, req('/api/profile')).kind).toBe('none');
  });
});

describe('apiPathOf', () => {
  it('strips the same-origin proxy prefix', () => {
    expect(apiPathOf('/api/qa-proxy/api/videos?limit=2', undefined)?.pathname).toBe('/api/videos');
  });
  it('recognises the API origin and ignores everything else', () => {
    expect(apiPathOf('https://api.example/api/videos', 'https://api.example')?.pathname).toBe('/api/videos');
    expect(apiPathOf('https://cdn.example/a.jpg', 'https://api.example')).toBeNull();
    expect(apiPathOf('/_next/static/a.js', undefined)).toBeNull();
  });
});

describe('createDemoFetch', () => {
  const api = 'https://api.example';
  const respond = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

  it('passes non-API requests straight through', async () => {
    const original = jest.fn(async () => new Response('x'));
    await createDemoFetch(original as unknown as typeof fetch, set, () => api)('https://cdn.example/a.jpg');
    expect(original).toHaveBeenCalledWith('https://cdn.example/a.jpg', undefined);
  });

  it('answers the home feed from per-channel listings, never the unfiltered scan', async () => {
    const original = jest.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('channelId=ch1')) return respond({ data: [{ id: 'v1', dateCreated: '2026-01-01' }], cursor: '' });
      if (u.includes('channelId=ch2')) return respond({ data: [{ id: 'junk' }, { id: 'v2', dateCreated: '2026-02-01' }], cursor: '' });
      if (u.endsWith('/api/videos/keep')) return respond({ id: 'keep', dateCreated: '2026-03-01' });
      if (u.includes('/api/channels/')) return respond({ id: u.split('/').pop() });
      throw new Error(`unexpected ${u}`);
    });
    const previous = process.env.API_URL;
    process.env.API_URL = api;
    try {
      const demoFetch = createDemoFetch(original as unknown as typeof fetch, set, () => api);
      const body = await (await demoFetch(`${api}/api/videos?limit=15`)).json();
      expect(body.data.map((v: { id: string }) => v.id)).toEqual(['keep', 'v2', 'v1']);
      expect(original.mock.calls.map(([u]) => String(u))).not.toContain(`${api}/api/videos?limit=15`);
    } finally {
      process.env.API_URL = previous;
    }
  });
});
