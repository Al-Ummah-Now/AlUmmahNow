/**
 * Shared by web and admin-web (worker.ts is identical in both apps).
 *
 * One robots meta on every error page (404, 410, 5xx), and the same one on every app of the family
 * (wiki guides/error-pages.md): "noindex, nofollow". Next adds its own `noindex` meta to any page
 * answered with a status above 400 (app-render NonIndex), next to the page's metadata robots, so
 * an error page would carry two. Here the first is kept with the family's value and the rest are
 * dropped (Workers HTMLRewriter; a runtime without it passes the page through).
 */
export const ERROR_ROBOTS = 'noindex, nofollow';

interface RewriterElement {
  setAttribute(n: string, v: string): void;
  remove(): void;
}
interface Rewriter {
  on(selector: string, handlers: { element(el: RewriterElement): void }): Rewriter;
  transform(response: Response): Response;
}

export function withOneRobotsMeta(response: Response): Response {
  if (response.status < 400) return response;
  const Ctor = (globalThis as { HTMLRewriter?: new () => Rewriter }).HTMLRewriter;
  if (!Ctor || !(response.headers.get('content-type') ?? '').includes('text/html')) return response;
  // The header says it too, whatever the markup carries
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', ERROR_ROBOTS);
  const tagged = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  let seen = false;
  return new Ctor()
    .on('meta[name="robots"]', {
      element: (el) => {
        if (seen) {
          el.remove();
          return;
        }
        seen = true;
        el.setAttribute('content', ERROR_ROBOTS);
      },
    })
    .transform(tagged);
}
