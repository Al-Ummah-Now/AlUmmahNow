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
    expect(out.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
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

describe('withStatusGlobal (the error card says 503 on a 503 page)', () => {
  const calls: string[] = [];
  class FakeRewriter {
    on(selector: string, h: { element(el: { prepend(c: string, o: { html: boolean }): void }): void }) {
      h.element({ prepend: (c) => calls.push(`${selector} prepend ${c}`) });
      return this;
    }
    transform(r: Response) {
      return r;
    }
  }
  afterEach(() => {
    delete (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter;
    calls.length = 0;
  });

  it('tells the page its status with a script carrying the CSP nonce', () => {
    (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter = FakeRewriter;
    const page = new Response('<html></html>', { status: 500, headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'self' 'nonce-n0nce=' 'strict-dynamic'" } });
    expect(asServiceUnavailable(req('/ar/video/abc'), page).status).toBe(503);
    expect(calls).toEqual(['head prepend <script nonce="n0nce=">window.__aunHttpStatus=503</script>']);
  });

  it('adds nothing without a nonce (no inline script the CSP would block)', () => {
    (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter = FakeRewriter;
    expect(asServiceUnavailable(req('/en/video/abc'), res(500)).status).toBe(503);
    expect(calls).toEqual([]);
  });
});
