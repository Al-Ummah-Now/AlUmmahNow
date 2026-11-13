/**
 * @jest-environment node
 */
import { asGoneIfPurged, goneLookupPath } from '../gone';

const env = { API_URL: 'https://videos.api.example/' };
const req = (path: string, method = 'GET') => new Request(`https://videos.example${path}`, { method });
const page = (status: number) => new Response('<html>not found</html>', { status, headers: { 'Content-Type': 'text/html' } });
const api = (status: number) => jest.fn(async () => new Response('{}', { status })) as unknown as typeof fetch;

describe('goneLookupPath', () => {
  it('maps watch, Shorts, playlist and channel pages to their API read', () => {
    expect(goneLookupPath('/en/video/abc')).toBe('/api/videos/abc');
    expect(goneLookupPath('/ar/shorts/abc/')).toBe('/api/videos/abc');
    expect(goneLookupPath('/en/playlist/p1')).toBe('/api/playlists/p1');
    expect(goneLookupPath('/en/channels/c1')).toBe('/api/channels/c1');
  });
  it('ignores every other page', () => {
    for (const path of ['/en', '/en/video', '/en/video/abc/edit', '/en/@handle', '/en/search', '/embed/v/abc', '/login']) {
      expect([path, goneLookupPath(path)]).toEqual([path, null]);
    }
  });
});

describe('asGoneIfPurged', () => {
  it('turns a 404 into 410 when the API says the item was purged', async () => {
    const fetcher = api(410);
    const out = await asGoneIfPurged(req('/en/video/abc'), page(404), env, fetcher);
    expect(out.status).toBe(410);
    expect(out.headers.get('Content-Type')).toBe('text/html');
    expect(await out.text()).toContain('not found');
    expect(fetcher).toHaveBeenCalledWith('https://videos.api.example/api/videos/abc', expect.anything());
  });
  it('keeps the 404 while the item can be restored, or when the lookup fails', async () => {
    expect((await asGoneIfPurged(req('/en/video/abc'), page(404), env, api(404))).status).toBe(404);
    const failing = jest.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect((await asGoneIfPurged(req('/en/video/abc'), page(404), env, failing)).status).toBe(404);
    expect((await asGoneIfPurged(req('/en/video/abc'), page(404), {}, api(410))).status).toBe(404);
  });
  it('never asks for other statuses, methods or pages', async () => {
    const fetcher = api(410);
    expect((await asGoneIfPurged(req('/en/video/abc'), page(200), env, fetcher)).status).toBe(200);
    expect((await asGoneIfPurged(req('/en/video/abc', 'POST'), page(404), env, fetcher)).status).toBe(404);
    expect((await asGoneIfPurged(req('/en/nope'), page(404), env, fetcher)).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
