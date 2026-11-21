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

describe('asGonePage (the error card switches to its 410 words)', () => {
  type El = { setAttribute(n: string, v: string): void; removeAttribute(n: string): void; setInnerContent(c: string): void; prepend(c: string, o: { html: boolean }): void };
  const calls: string[] = [];
  class FakeRewriter {
    private sel: string[] = [];
    on(selector: string, h: { element(el: El): void }) {
      this.sel.push(selector);
      h.element({ setAttribute: (n, v) => calls.push(`${selector} set ${n}=${v}`), removeAttribute: (n) => calls.push(`${selector} rm ${n}`), setInnerContent: (c) => calls.push(`${selector} text ${c}`), prepend: (c) => calls.push(`${selector} prepend ${c}`) });
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

  it('shows the 410 block, hides the 404 one and retitles the page in its language', async () => {
    (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter = FakeRewriter;
    const csp = new Response('<html></html>', { status: 404, headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'self' 'nonce-abc123=' 'strict-dynamic'" } });
    const out = await asGoneIfPurged(req('/ar/video/abc'), csp, env, api(410));
    expect(out.status).toBe(410);
    expect(calls).toEqual([
      '[data-error-status="404"] set data-error-status=410',
      '.ep-head[data-when="404"] set hidden=',
      '.ep-head[data-when="410"] rm hidden',
      'title text حُذف هذا المحتوى',
      // the card reads it after Next renders the tree again in the browser (ErrorScreen)
      'head prepend <script nonce="abc123=">window.__aunHttpStatus=410</script>',
    ]);
  });

  it('without HTMLRewriter (tests, Node) the body passes through unchanged', async () => {
    const out = await asGoneIfPurged(req('/en/video/abc'), page(404), env, api(410));
    expect(out.status).toBe(410);
    expect(await out.text()).toBe('<html>not found</html>');
  });
});
