/**
 * Crawler rules for the videos site (wiki: AUN-SEO, "robots rules").
 *
 * - Every non-production deployment (QA, stage, preview, local) is noindex everywhere and its
 *   robots.txt disallows everything, like www.
 * - On production, pages that are private to the viewer or only useful to them (search results,
 *   history, library, settings, upload, Studio...) send `X-Robots-Tag: noindex`. They stay
 *   crawlable in robots.txt so crawlers can read the noindex.
 */

const PRODUCTION_HOSTS = new Set(['videos.alummahnow.net']);

/**
 * Production means the Worker says so (NEXTJS_ENV=production). When the variable is missing the
 * host decides, so a misconfigured QA Worker is never indexable and production is never hidden.
 */
export function isProductionDeployment(environment: string | undefined, host: string | null | undefined): boolean {
  if (environment) return environment === 'production';
  return !!host && PRODUCTION_HOSTS.has(host.toLowerCase().split(':')[0]);
}

/** Search results: not indexed, but their links may be followed. */
const NOINDEX_FOLLOW = /^\/[a-z]{2}\/search(\/|$)/;

/** Pages for the signed-in viewer, tools and errors: neither indexed nor followed. */
const NOINDEX_NOFOLLOW = new RegExp(
  '^/[a-z]{2}/(' +
    [
      'history', 'library', 'settings', 'upload', 'studio', 'notifications', 'profile',
      'subscriptions', 'feed', 'dashboard', 'analytics', 'scheduled-videos', 'auth', 'dev',
      'video/[^/]+/edit',
    ].join('|') +
    ')(/|$)',
);

export const NOINDEX = 'noindex, nofollow';

/** The X-Robots-Tag header for a page, or null when it may be indexed. */
export function robotsHeaderFor(pathname: string, production: boolean): string | null {
  if (!production) return NOINDEX;
  if (NOINDEX_FOLLOW.test(pathname)) return 'noindex, follow';
  if (NOINDEX_NOFOLLOW.test(pathname)) return NOINDEX;
  return null;
}

/** robots.txt body. Production has no Sitemap line until the sitemaps exist. */
export function robotsTxt(production: boolean): string {
  if (!production) return 'User-agent: *\nDisallow: /\n';
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', ''].join('\n');
}

/**
 * /<locale>/video?vid=<id> (or /video?vid=<id>, in `fallbackLocale`) → the canonical
 * /<locale>/video/<id>, other query kept; null when the URL is not that form
 */
export function legacyWatchRedirect(pathname: string, search: URLSearchParams, fallbackLocale: string): string | null {
  const match = /^(?:\/([a-z]{2}))?\/video\/?$/.exec(pathname);
  const vid = search.get('vid');
  if (!match || !vid) return null;
  const rest = new URLSearchParams(search);
  rest.delete('vid');
  const query = rest.toString();
  return `/${match[1] || fallbackLocale}/video/${encodeURIComponent(vid)}${query ? `?${query}` : ''}`;
}
