jest.mock('@/lib/logger-server', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockGetServerAuthContext = jest.fn();
jest.mock('../server-auth', () => ({
  getServerAuthContext: () => mockGetServerAuthContext(),
}));

const mockApiRequestServerResult = jest.fn();
jest.mock('../api-client', () => ({
  apiRequestServerResult: (...args: unknown[]) => mockApiRequestServerResult(...args),
  buildApiUrl: (path: string) => `http://api.test${path}`,
}));

const mockLoadPublicVideo = jest.fn();
jest.mock('@/lib/embed/content', () => ({
  loadPublicVideo: (videoId: string) => mockLoadPublicVideo(videoId),
}));

import { getHomeLibrary } from '../home-library';
import { stableImages } from '@/lib/ssr/stable-images';

const historyEntry = (videoId: string) => ({
  id: `u1:${videoId}`,
  userId: 'u1',
  videoId,
  videoTitle: `Talk ${videoId}`,
  videoThumbnail: `https://vz-1.b-cdn.net/${videoId}/thumbnail.jpg?token=abc&expires=999`,
  videoDuration: 600,
  channelId: 'c1',
  channelName: 'Noor',
  firstWatchedAt: '',
  lastWatchedAt: '',
  watchCount: 1,
  progress: 240,
  completed: false,
  percentageWatched: 40,
});

const libraryVideo = (id: string) => ({
  id,
  title: `Video ${id}`,
  thumbnailUrl: `https://vz-1.b-cdn.net/${id}/thumbnail.jpg?token=abc&expires=999`,
  channelName: 'Noor',
  views: 10,
  isPublic: true,
});

describe('getHomeLibrary (server-side home library loader)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadPublicVideo.mockResolvedValue(null);
  });

  it('returns empty cards without calling the API when signed out', async () => {
    mockGetServerAuthContext.mockResolvedValueOnce(null);
    await expect(getHomeLibrary()).resolves.toEqual({ cards: [], userId: null });
    expect(mockApiRequestServerResult).not.toHaveBeenCalled();
  });

  it('loads Continue watching, Watch later, and Liked videos in order and resolves public history covers on the server', async () => {
    mockGetServerAuthContext.mockResolvedValueOnce({ userId: 'u1', accessToken: 'tok-1', channelId: 'c1' });
    mockApiRequestServerResult
      .mockResolvedValueOnce({ status: 200, data: { paused: false } })
      .mockResolvedValueOnce({ status: 200, data: { entries: [historyEntry('h1'), historyEntry('h2')], total: 4, hasMore: true } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [libraryVideo('w1')], total: 2, videoIds: ['x', 'w1'], nextCursor: null, playlistId: 'wl' } } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [libraryVideo('l1')], total: 5, nextCursor: null } } });
    mockLoadPublicVideo.mockImplementation(async (id: string) => ({ id, poster: `/thumb/${id}.jpg` }));

    const res = await getHomeLibrary();
    expect(res?.userId).toBe('u1');
    expect(res?.cards.map((c) => c.kind)).toEqual(['continue', 'watch-later', 'liked']);
    expect(res?.cards[1]).toMatchObject({ kind: 'watch-later', index: 1, total: 2 });
    expect(mockApiRequestServerResult).toHaveBeenCalledTimes(4);
    expect(mockLoadPublicVideo).toHaveBeenCalledWith('h1');
    expect(mockLoadPublicVideo).toHaveBeenCalledWith('h2');

    // Public Continue-watching covers are already /thumb/<id>.jpg, so stableImages is non-partial (0 client requests)
    const stabilized = stableImages(res!.cards);
    expect(stabilized.partial).toBe(false);
    expect(JSON.stringify(stabilized.value)).not.toMatch(/token=|b-cdn/);
    if (stabilized.value[0].kind === 'continue') {
      expect(stabilized.value[0].top.videoThumbnail).toBe('/thumb/h1.jpg');
      expect(stabilized.value[0].next[0].videoThumbnail).toBe('/thumb/h2.jpg');
    }
  });

  it('skips loadPublicVideo for Continue-watching entries already proven public by Watch later or Liked', async () => {
    mockGetServerAuthContext.mockResolvedValueOnce({ userId: 'u1', accessToken: 'tok-1' });
    mockApiRequestServerResult
      .mockResolvedValueOnce({ status: 200, data: { paused: false } })
      .mockResolvedValueOnce({ status: 200, data: { entries: [historyEntry('w1')], total: 1, hasMore: false } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [libraryVideo('w1')], total: 1, videoIds: ['w1'], nextCursor: null, playlistId: 'wl' } } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [], total: 0, nextCursor: null } } });

    const res = await getHomeLibrary();
    expect(mockLoadPublicVideo).not.toHaveBeenCalled();
    if (res?.cards[0]?.kind === 'continue') {
      expect(res.cards[0].top.videoThumbnail).toBe('/thumb/w1.jpg');
    }
  });

  it('keeps private Continue-watching covers stripped (partial: true) when loadPublicVideo returns null', async () => {
    mockGetServerAuthContext.mockResolvedValueOnce({ userId: 'u1', accessToken: 'tok-1' });
    mockApiRequestServerResult
      .mockResolvedValueOnce({ status: 200, data: { paused: false } })
      .mockResolvedValueOnce({ status: 200, data: { entries: [historyEntry('priv1')], total: 1, hasMore: false } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [], total: 0, videoIds: [], nextCursor: null, playlistId: 'wl' } } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [], total: 0, nextCursor: null } } });
    mockLoadPublicVideo.mockResolvedValueOnce(null);

    const res = await getHomeLibrary();
    const stabilized = stableImages(res!.cards);
    expect(stabilized.partial).toBe(true);
    expect(JSON.stringify(stabilized.value)).not.toMatch(/token=|b-cdn/);
    if (stabilized.value[0].kind === 'continue') {
      expect(stabilized.value[0].top.videoThumbnail).toBeUndefined();
    }
  });

  it('returns empty cards (not undefined) when all three lists are legitimately empty', async () => {
    mockGetServerAuthContext.mockResolvedValueOnce({ userId: 'u1', accessToken: 'tok-1' });
    mockApiRequestServerResult
      .mockResolvedValueOnce({ status: 200, data: { paused: false } })
      .mockResolvedValueOnce({ status: 200, data: { entries: [], total: 0, hasMore: false } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [], total: 0, videoIds: [], nextCursor: null, playlistId: 'wl' } } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [], total: 0, nextCursor: null } } });

    await expect(getHomeLibrary()).resolves.toEqual({ cards: [], userId: 'u1' });
    expect(mockLoadPublicVideo).not.toHaveBeenCalled();
  });

  it('drops Continue watching when history is paused and keeps Watch later and Liked', async () => {
    mockGetServerAuthContext.mockResolvedValueOnce({ userId: 'u1', accessToken: 'tok-1' });
    mockApiRequestServerResult
      .mockResolvedValueOnce({ status: 200, data: { paused: true } })
      .mockResolvedValueOnce({ status: 200, data: { entries: [historyEntry('h1')], total: 1, hasMore: false } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [libraryVideo('w1')], total: 1, videoIds: ['w1'], nextCursor: null, playlistId: 'wl' } } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [], total: 0, nextCursor: null } } });

    const res = await getHomeLibrary();
    expect(res?.cards.map((c) => c.kind)).toEqual(['watch-later']);
    expect(mockLoadPublicVideo).not.toHaveBeenCalled();
  });

  it('keeps surviving cards when one list fails (partial outage)', async () => {
    mockGetServerAuthContext.mockResolvedValueOnce({ userId: 'u1', accessToken: 'tok-1' });
    mockApiRequestServerResult
      .mockResolvedValueOnce({ status: 500, data: null })
      .mockResolvedValueOnce({ status: 500, data: null })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [libraryVideo('w1')], total: 1, videoIds: ['w1'], nextCursor: null, playlistId: 'wl' } } })
      .mockResolvedValueOnce({ status: 200, data: { result: { items: [], total: 0, nextCursor: null } } });

    const res = await getHomeLibrary();
    expect(res?.cards.map((c) => c.kind)).toEqual(['watch-later']);
  });

  it('returns undefined when every library request fails (timeout / outage / 401)', async () => {
    mockGetServerAuthContext.mockResolvedValueOnce({ userId: 'u1', accessToken: 'tok-1' });
    mockApiRequestServerResult
      .mockResolvedValueOnce({ status: null, data: null })
      .mockResolvedValueOnce({ status: null, data: null })
      .mockResolvedValueOnce({ status: 503, data: null })
      .mockResolvedValueOnce({ status: 500, data: null });

    await expect(getHomeLibrary()).resolves.toBeUndefined();
  });
});
