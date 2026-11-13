/**
 * @jest-environment node
 */
import { asServiceUnavailable } from '../unavailable';

const req = (path: string, method = 'GET') => new Request(`https://videos.alummahnow.net${path}`, { method });
const res = (status: number) => new Response('body', { status, headers: { 'Content-Type': 'text/html' } });

describe('asServiceUnavailable', () => {
  it('turns a failed page render into 503 with Retry-After', async () => {
    const out = asServiceUnavailable(req('/en/video/abc'), res(500));
    expect(out.status).toBe(503);
    expect(out.headers.get('Retry-After')).toBe('120');
    expect(out.headers.get('Cache-Control')).toBe('no-store');
    expect(out.headers.get('Content-Type')).toBe('text/html');
    expect(await out.text()).toBe('body');
  });
  it('leaves other statuses, methods and paths alone', () => {
    const ok = res(200);
    expect(asServiceUnavailable(req('/en/video/abc'), ok)).toBe(ok);
    const notFound = res(404);
    expect(asServiceUnavailable(req('/en/video/abc'), notFound)).toBe(notFound);
    const post = res(500);
    expect(asServiceUnavailable(req('/en/video/abc', 'POST'), post)).toBe(post);
    const api = res(500);
    expect(asServiceUnavailable(req('/api/contact'), api)).toBe(api);
    const embed = res(500);
    expect(asServiceUnavailable(req('/embed/v/abc'), embed)).toBe(embed);
  });
});
