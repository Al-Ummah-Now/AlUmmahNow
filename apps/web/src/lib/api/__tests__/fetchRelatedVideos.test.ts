/**
 * The related shelf tells a failure from an empty answer (#1552): the API helpers it builds on
 * turn a failed request into an empty list, so the shelf asks for the failure itself.
 */
jest.mock('../api-client', () => ({
  apiRequestServer: jest.fn(),
  apiRequestServerResult: jest.fn(),
  buildApiUrl: (path: string) => `https://api.test${path}`,
}));
jest.mock('../server-auth', () => ({ getServerAuthContext: async () => null }));

import { apiRequestServer } from '../api-client';
import { fetchRelatedVideos, getRecommendedVideos, getTrendingVideos } from '../videos';
import { LAST_GOOD_SHELF_KEY, RelatedUnavailableError } from '@/lib/video/related';

const listFeed = apiRequestServer as jest.Mock;
const fetchMock = jest.fn();
const originalFetch = global.fetch;

const apiVideo = (id: string) => ({ id, title: id, dateCreated: '2026-11-01T00:00:00Z', dateModified: '2026-11-01T00:00:00Z' });
const answer = (videos: unknown[]) => ({ ok: true, status: 200, json: async () => ({ data: videos }) });
const serverError = { ok: false, status: 503, json: async () => ({}) };

describe('fetchRelatedVideos', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sessionStorage.clear();
    fetchMock.mockReset();
    listFeed.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  /** Runs the shelf through its retry wait. */
  async function load(videoId: string) {
    const settled = fetchRelatedVideos(videoId).then((videos) => ({ videos }), (error: unknown) => ({ error }));
    await jest.runAllTimersAsync();
    return settled;
  }

  it('rejects when every request fails and no shelf is remembered', async () => {
    fetchMock.mockResolvedValue(serverError); // recommendations and trending
    listFeed.mockRejectedValue(new Error('network')); // the feed
    const result = await load('cur');
    expect(result).toEqual({ error: expect.any(RelatedUnavailableError) });
  });

  it('rejects when the network is down', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    listFeed.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await load('cur')).toEqual({ error: expect.any(RelatedUnavailableError) });
  });

  it('resolves empty when the API answered with nothing but this video', async () => {
    fetchMock.mockResolvedValue(answer([]));
    listFeed.mockResolvedValue({ cursor: null, data: [apiVideo('cur')] });
    expect(await load('cur')).toEqual({ videos: [] });
  });

  it('shows the remembered shelf when every request fails', async () => {
    sessionStorage.setItem(LAST_GOOD_SHELF_KEY, JSON.stringify([{ ...apiVideo('saved'), channel: '' }]));
    fetchMock.mockResolvedValue(serverError);
    listFeed.mockRejectedValue(new Error('network'));
    const result = await load('cur');
    expect('videos' in result && result.videos.map((v) => v.id)).toEqual(['saved']);
  });

  it('lists recommendations first', async () => {
    fetchMock.mockResolvedValue(answer([apiVideo('r1')]));
    listFeed.mockResolvedValue({ cursor: null, data: [apiVideo('f1')] });
    const result = await load('cur');
    expect('videos' in result && result.videos.map((v) => v.id)).toEqual(['r1', 'f1']);
  });
});

describe('recommendation and trending helpers keep their contract', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('still resolve an empty list on a failed request (other callers rely on it)', async () => {
    global.fetch = jest.fn().mockResolvedValue(serverError) as unknown as typeof fetch;
    await expect(getRecommendedVideos({ videoId: 'cur' })).resolves.toEqual([]);
    await expect(getTrendingVideos('day')).resolves.toEqual([]);
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    await expect(getRecommendedVideos({ videoId: 'cur' })).resolves.toEqual([]);
    await expect(getTrendingVideos('day')).resolves.toEqual([]);
  });
});
