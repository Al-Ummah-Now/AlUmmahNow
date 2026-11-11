/**
 * Playlist embeds read the playback queue API (docs/specs/PLAYLIST-PLAYBACK.md phase 2): the saved
 * order, every page (no 200 cap), the stored index kept for "Watch on", and the older expanded
 * read while the queue API is not deployed.
 */
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: <T,>(fn: T) => fn }));
jest.mock('@/lib/logger-server', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { loadPublicPlaylist } from '../content';

const API = 'https://api.example';
const item = (i: number) => ({ id: `v${i}`, index: i * 2, title: `Lesson ${i}`, playUrl: `https://cdn.example/v${i}/playlist.m3u8`, uploadStatus: 'ready', duration: 60, channelName: 'Ch' });

function respond(routes: Record<string, unknown>) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    const path = String(url).replace(API, '');
    calls.push(path);
    const body = routes[path];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe('loadPublicPlaylist', () => {
  beforeEach(() => {
    process.env.API_URL = API;
  });

  it('pages the queue in saved order and keeps each item\'s stored index', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => item(i));
    const page2 = [item(100), { ...item(101), playUrl: undefined }];
    const calls = respond({
      '/api/playlists/p1/queue?offset=0&limit=100': { result: { playlist: { id: 'p1', title: 'Series', isPublic: true, channelName: 'Ch' }, items: page1, nextOffset: 100 } },
      '/api/playlists/p1/queue?offset=100&limit=100': { result: { playlist: { id: 'p1', title: 'Series', isPublic: true }, items: page2, nextOffset: null } },
    });
    const list = await loadPublicPlaylist('p1');
    expect(calls).toHaveLength(2);
    expect(list?.title).toBe('Series');
    // The item with nothing to play is left out; the order is the API's
    expect(list?.videos.map((v) => v.id)).toEqual([...page1.map((v) => v.id), 'v100']);
    expect(list?.videos[3].listIndex).toBe(6);
  });

  it('a private list is not embeddable', async () => {
    respond({ '/api/playlists/p2/queue?offset=0&limit=100': { result: { playlist: { id: 'p2', title: 'Mine', isPublic: false }, items: [item(1)], nextOffset: null } } });
    expect(await loadPublicPlaylist('p2')).toBeNull();
  });

  it('falls back to the expanded playlist read before the queue API is deployed', async () => {
    respond({ '/api/playlists/p3?includeVideos=true': { id: 'p3', title: 'Old', isPublic: true, videoItems: [item(1)] } });
    const list = await loadPublicPlaylist('p3');
    expect(list?.videos.map((v) => v.id)).toEqual(['v1']);
  });
});
