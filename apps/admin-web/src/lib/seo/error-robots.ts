/**
 * Shared by web and admin-web (worker.ts is identical in both apps).
 *
 * One robots meta on every error page (404, 410, 5xx), and the family's "noindex, nofollow" in the
 * X-Robots-Tag header (wiki guides/error-pages.md). Next renders its own `noindex` meta on any page
 * answered with a status above 400 (app-render NonIndex, and again in the HTML for a notFound()), and
 * error routes set no robots of their own (lib/seo/not-found-metadata.ts). Here the first robots meta
 * is kept exactly as it is and the rest are dropped (Workers HTMLRewriter; a runtime without it passes
 * the page through). Never rewrite the kept one: React claims a server <meta> on hydration only when
 * its content matches what it renders, so a rewritten one gets a fresh `noindex` twin beside it.
 */
export const ERROR_ROBOTS = 'noindex, nofollow';

interface RewriterElement {
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
      },
    })
    .transform(tagged);
}
