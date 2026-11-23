/**
 * @jest-environment node
 */
import { ERROR_ROBOTS, withOneRobotsMeta } from '../error-robots';

describe('withOneRobotsMeta (one robots meta on an error page)', () => {
  const calls: string[] = [];
  class FakeRewriter {
    on(selector: string, h: { element(el: { setAttribute(n: string, v: string): void; remove(): void }): void }) {
      // Two robots metas on the page: Next's NonIndex and the one it adds to the HTML for a notFound()
      for (let i = 0; i < 2; i++) h.element({ setAttribute: (n, v) => calls.push(`${i} set ${n}=${v}`), remove: () => calls.push(`${i} removed`) });
      calls.push(`selector ${selector}`);
      return this;
    }
    transform(r: Response) {
      return r;
    }
  }
  const html = (status: number) => new Response('<html></html>', { status, headers: { 'Content-Type': 'text/html' } });
  afterEach(() => {
    delete (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter;
    calls.length = 0;
  });

  it('keeps the first exactly as it is (hydration claims it), drops the rest, and sends noindex, nofollow in the header', () => {
    (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter = FakeRewriter;
    for (const status of [404, 410, 500, 503]) {
      calls.length = 0;
      const out = withOneRobotsMeta(html(status));
      expect(out.status).toBe(status);
      expect(out.headers.get('X-Robots-Tag')).toBe(ERROR_ROBOTS);
      // Never rewritten: React adopts a server <meta> only when its content matches, else it adds a twin
      expect(calls).toEqual(['1 removed', 'selector meta[name="robots"]']);
    }
    expect(ERROR_ROBOTS).toBe('noindex, nofollow');
  });

  it('leaves pages that are not errors, and non-HTML answers, alone', () => {
    (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter = FakeRewriter;
    const ok = html(200);
    expect(withOneRobotsMeta(ok)).toBe(ok);
    const json = new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    expect(withOneRobotsMeta(json)).toBe(json);
    expect(calls).toEqual([]);
  });
});
