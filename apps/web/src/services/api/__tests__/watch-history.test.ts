/**
 * WatchHistoryService must call the api-videos watch-history routes
 * (/api/watch-history...), not the non-existent /api/profile/watch-history.
 */

jest.mock('@/lib/runtime-config', () => ({
  getApiUrl: () => 'https://api.test',
}));

jest.mock('@/lib/auth/client-token', () => ({
  getClientAuthHeaders: jest.fn(async () => ({ Authorization: 'Bearer client-token', channelId: 'ch-1' })),
}));

jest.mock('@/lib/logger-client', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { WatchHistoryService } from '../watch-history';

type FetchMock = jest.Mock<Promise<Partial<Response>>, [string, RequestInit?]>;

function mockResponse(status: number, body: unknown = {}): Partial<Response> {
  return { ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => body };
}

describe('WatchHistoryService', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as { fetch: FetchMock }).fetch = fetchMock;
  });

  it('updates progress on /api/watch-history/:videoId/progress', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200));
    const result = await WatchHistoryService.saveProgress(
      { videoId: 'v1', currentTime: 42, duration: 100, completed: false, timestamp: '2026-01-01T00:00:00Z' },
      'token'
    );
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/watch-history/v1/progress');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ progress: 42, duration: 100 });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it('records the watch on POST /api/watch-history when no entry exists yet', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(404)).mockResolvedValueOnce(mockResponse(201));
    const result = await WatchHistoryService.saveProgress(
      { videoId: 'v1', currentTime: 5, duration: 100, completed: false, timestamp: '2026-01-01T00:00:00Z' },
      'token'
    );
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/api/watch-history');
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ videoId: 'v1', progress: 5, duration: 100 });
  });

  it('maps GET /api/watch-history/:videoId/progress to WatchProgress', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { videoId: 'v1', progress: 30, duration: 60, completed: false, lastWatchedAt: '2026-01-02T00:00:00Z' }));
    const progress = await WatchHistoryService.getProgress('v1', 'token');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/watch-history/v1/progress');
    expect(progress).toEqual({ videoId: 'v1', currentTime: 30, duration: 60, completed: false, timestamp: '2026-01-02T00:00:00Z' });
  });

  it('filters the list by completion (Continue watching)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { entries: [], total: 0, hasMore: false }));
    await WatchHistoryService.list({ limit: 10, completed: false });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/watch-history?sort=newest&limit=10&completed=false');
  });

  it('lists, removes and clears history with client auth headers', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(200, { entries: [], total: 0, hasMore: false }))
      .mockResolvedValueOnce(mockResponse(200))
      .mockResolvedValueOnce(mockResponse(200));

    await WatchHistoryService.list({ limit: 10, cursor: '20' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/watch-history?sort=newest&limit=10&cursor=20');
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer client-token');

    expect(await WatchHistoryService.remove('v 1')).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.test/api/watch-history/v%201');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE');

    expect(await WatchHistoryService.clearAll()).toBe(true);
    expect(fetchMock.mock.calls[2][0]).toBe('https://api.test/api/watch-history');
    expect(fetchMock.mock.calls[2][1]?.method).toBe('DELETE');
  });

  it('reads and changes the pause setting on /api/watch-history/settings', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { paused: false }));
    expect(await WatchHistoryService.getPaused()).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/watch-history/settings');

    fetchMock.mockResolvedValueOnce(mockResponse(200, { paused: true }));
    expect(await WatchHistoryService.setPaused(true)).toBe(true);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.test/api/watch-history/settings');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ paused: true });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer client-token');

    fetchMock.mockResolvedValueOnce(mockResponse(500));
    expect(await WatchHistoryService.setPaused(false)).toBeNull();
  });

  it('never calls the legacy /api/profile/watch-history path', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, {}));
    await WatchHistoryService.saveProgress({ videoId: 'v1', currentTime: 1, duration: 100, completed: false, timestamp: '' }, 't');
    await WatchHistoryService.getProgress('v1', 't');
    for (const [url] of fetchMock.mock.calls) {
      expect(url).not.toContain('/api/profile/watch-history');
    }
  });
});
