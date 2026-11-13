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

/**
 * Training-only AI crawlers, blocked on every public host (owner decision D-SEO-8, same list as
 * www). AI search and answer bots that link back (OAI-SearchBot, ChatGPT-User, PerplexityBot,
 * Claude-SearchBot, Claude-User, DuckAssistBot, Applebot...) stay on the general rules.
 */
export const AI_TRAINING_CRAWLERS = [
  'Google-Extended', 'GPTBot', 'CCBot', 'ClaudeBot', 'anthropic-ai', 'Applebot-Extended', 'Bytespider',
  'meta-externalagent', 'FacebookBot', 'cohere-training-data-crawler', 'Diffbot', 'Omgilibot',
  'img2dataset', 'PanguBot', 'Timpibot',
] as const;

/** robots.txt body; production names its sitemap index (lib/seo/sitemaps.ts). */
export function robotsTxt(production: boolean, origin?: string): string {
  if (!production) return 'User-agent: *\nDisallow: /\n';
  const blocked = AI_TRAINING_CRAWLERS.map((bot) => `User-agent: ${bot}\nDisallow: /\n`).join('\n');
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', blocked, ...(origin ? [`Sitemap: ${origin}/sitemap.xml`, ''] : [])].join('\n');
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
