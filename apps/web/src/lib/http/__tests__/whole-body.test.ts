/**
 * @jest-environment node
 *
 * Share images leave with a Content-Length, never chunked (OpenNext streams Next responses).
 */
import { withWholeBody } from '../whole-body';

const streamed = (bytes: Uint8Array, status = 200) =>
  new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), { status, headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600' } });
const get = (path: string, method = 'GET') => new Request(`https://videos.alummahnow.net${path}`, { method });

describe('withWholeBody', () => {
  it('sends /og cards and /thumb images whole, with their length and headers kept', async () => {
    for (const path of ['/og/v/55e83716-15ca-41d9-af12-12d7a7e44e79.jpg', '/og/c/c1.jpg', '/og/i/aHR0cHM.jpg', '/thumb/v1.jpg']) {
      const res = await withWholeBody(get(path), streamed(new Uint8Array([1, 2, 3, 4, 5])));
      expect(res.headers.get('content-length')).toBe('5');
      expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    }
  });

  it('leaves pages, errors and other methods alone', async () => {
    const page = streamed(new Uint8Array([1]));
    expect(await withWholeBody(get('/en/video/v1'), page)).toBe(page);
    const missing = streamed(new Uint8Array([1]), 404);
    expect(await withWholeBody(get('/og/v/v1.jpg'), missing)).toBe(missing);
    const post = streamed(new Uint8Array([1]));
    expect(await withWholeBody(get('/og/v/v1.jpg', 'POST'), post)).toBe(post);
  });
});
