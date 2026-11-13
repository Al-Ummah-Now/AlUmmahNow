/** The admin site is never for search engines (wiki: AUN-SEO); next.config.ts adds X-Robots-Tag to every response. */
export function GET(): Response {
  return new Response('User-agent: *\nDisallow: /\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
