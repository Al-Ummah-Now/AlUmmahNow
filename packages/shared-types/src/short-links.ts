/**
 * Short share links on alummahnow.link (wiki AUN-SHORT-LINKS, apps/short-links). A short link
 * REDIRECTS to the real page; Open Graph tags and the canonical URL stay on the real page.
 *
 *   /v/<videoId>      → the watch page (a Short's own page once /shorts/<id> exists)
 *   /s/<videoId>      → the Short
 *   /@<handle>        → the channel by @handle
 *   /c/<channelId>    → the channel
 *   /p/<postId>       → the community post (its channel's Community tab)
 *   /l/<playlistId>   → the playlist
 *   /                 → the www home
 *
 * Hosts: production alummahnow.link, stage stage.alummahnow.link, QA qa.alummahnow.link.
 * Kept query parameters: t, list, index, lang (en|ar) and utm_*; anything else is dropped.
 *
 * Clicks are counted as daily aggregate counters (client analytics kind 'short_link', processor
 * site counters, entity 'site' id 'short-links'): the link type and where the click came from.
 * No id, IP or user agent is stored, the same model as site visits (site-visits.ts).
 */

export type ShortLinkTarget =
  | { kind: 'video'; id: string }
  | { kind: 'short'; id: string }
  | { kind: 'channel'; id: string }
  | { kind: 'handle'; handle: string }
  | { kind: 'post'; id: string }
  | { kind: 'playlist'; id: string }
  | { kind: 'home' };

export type ShortLinkKind = ShortLinkTarget['kind'];

const PREFIX: Record<Exclude<ShortLinkKind, 'handle' | 'home'>, string> = {
  video: 'v',
  short: 's',
  channel: 'c',
  post: 'p',
  playlist: 'l',
};
const KIND_BY_PREFIX: Record<string, Exclude<ShortLinkKind, 'handle' | 'home'>> = {
  v: 'video',
  s: 'short',
  c: 'channel',
  p: 'post',
  l: 'playlist',
};

/** Ids are UUIDs or slug-like keys; anything else is not a short link (no lookup is made). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Channel handles: 3-30 Latin letters, digits, '.', '_', '-', starting and ending with a letter or digit */
const HANDLE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{1,28})[A-Za-z0-9]$/;

/** Query parameters a short link keeps (passed on to the page it redirects to). */
export const SHORT_LINK_KEPT_PARAMS = ['t', 'list', 'index'] as const;
const UTM_PARAM = /^utm_(source|medium|campaign|term|content|id)$/;

/** The short link host of an environment, from the host of any of its sites (null: no short links there, e.g. localhost). */
export function shortLinkOriginFor(siteHostOrOrigin: string | null | undefined): string | null {
  if (!siteHostOrOrigin) return null;
  let host = siteHostOrOrigin;
  try {
    if (host.includes('://')) host = new URL(host).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().split(':')[0] ?? '';
  if (host.endsWith('.alummahnow.link') || host === 'alummahnow.link') {
    return `https://${host}`;
  }
  if (host !== 'alummahnow.net' && !host.endsWith('.alummahnow.net')) return null;
  const labels = host.split('.');
  if (labels.includes('qa')) return 'https://qa.alummahnow.link';
  if (labels.includes('stage')) return 'https://stage.alummahnow.link';
  // PR previews and other one-off hosts have no short links
  if (labels.some((l) => /^pr-?\d+$/.test(l) || l === 'preview' || l === 'dev')) return null;
  return 'https://alummahnow.link';
}

export interface ShortLinkOptions {
  /** Start position in seconds (videos) */
  t?: number | null;
  /** A public playlist playing with the video */
  list?: { id: string; index?: number | null } | null;
  /** Open the page in this language; omitted, the site's own default applies */
  lang?: 'en' | 'ar' | null;
}

/** The path of a short link (no host), or null when the id cannot be a short link. */
export function shortLinkPath(target: ShortLinkTarget): string | null {
  switch (target.kind) {
    case 'home':
      return '/';
    case 'handle': {
      const handle = target.handle.replace(/^@/, '');
      return HANDLE_PATTERN.test(handle) ? `/@${handle}` : null;
    }
    default:
      return ID_PATTERN.test(target.id) ? `/${PREFIX[target.kind]}/${target.id}` : null;
  }
}

/**
 * The short link of a page, or null when this environment has no short link host (the caller then
 * shares the page's own URL). `origin` is the short link host (shortLinkOriginFor).
 */
export function shortLinkUrl(origin: string | null | undefined, target: ShortLinkTarget, options: ShortLinkOptions = {}): string | null {
  if (!origin) return null;
  const path = shortLinkPath(target);
  if (!path) return null;
  const url = new URL(path, origin.endsWith('/') ? origin : `${origin}/`);
  if (options.list?.id && ID_PATTERN.test(options.list.id)) {
    url.searchParams.set('list', options.list.id);
    if (options.list.index != null && options.list.index >= 0) url.searchParams.set('index', String(Math.floor(options.list.index)));
  }
  if (options.t && options.t >= 1) url.searchParams.set('t', String(Math.floor(options.t)));
  if (options.lang === 'en' || options.lang === 'ar') url.searchParams.set('lang', options.lang);
  return url.toString();
}

/** What a short link path points at, or null (not a short link: the Worker answers 404). */
export function parseShortLinkPath(pathname: string): ShortLinkTarget | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // One trailing slash is forgiven (/v/abc/), nothing else
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path === '' || path === '/') return { kind: 'home' };
  const handle = /^\/@([^/]+)$/.exec(path);
  if (handle) return HANDLE_PATTERN.test(handle[1]!) ? { kind: 'handle', handle: handle[1]! } : null;
  const m = /^\/([a-z])\/([^/]+)$/.exec(path);
  if (!m) return null;
  const kind = KIND_BY_PREFIX[m[1]!];
  if (!kind || !ID_PATTERN.test(m[2]!)) return null;
  return { kind, id: m[2]! };
}

/**
 * The query string a short link passes on: t, list, index and utm_* only, with ids and numbers
 * checked so a short link cannot carry anything else to the page. `lang` is read separately.
 */
export function keptShortLinkParams(params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  const t = params.get('t');
  if (t && /^\d{1,6}s?$/.test(t)) out.set('t', t.replace(/s$/, ''));
  const list = params.get('list');
  if (list && ID_PATTERN.test(list)) {
    out.set('list', list);
    const index = params.get('index');
    if (index && /^\d{1,5}$/.test(index)) out.set('index', index);
  }
  for (const [key, value] of params) {
    if (UTM_PARAM.test(key) && value.length <= 200 && !out.has(key)) out.set(key, value);
  }
  return out;
}

/** The language a short link asks for (?lang=en|ar), or null: the site's own default applies. */
export function shortLinkLang(params: URLSearchParams): 'en' | 'ar' | null {
  const lang = (params.get('lang') ?? '').toLowerCase();
  return lang === 'en' || lang === 'ar' ? lang : null;
}

/** Link types counted for clicks ('unknown': a short link that did not resolve). */
export const SHORT_LINK_CLICK_TYPES = ['video', 'short', 'channel', 'post', 'playlist', 'home', 'unknown'] as const;
export type ShortLinkClickType = (typeof SHORT_LINK_CLICK_TYPES)[number];

/** One short link click, as the short link Worker reports it (no id, no identifier). */
export interface ShortLinkClickEvent {
  type: ShortLinkClickType;
  /** Where the click came from (visitSourceOf of the Referer host) */
  source: string;
}

const CLICK_SOURCE_PATTERN = /^(direct|site|platform|search:[a-z]{2,20}|social:[a-z]{2,20})$/;

export function isShortLinkClickEvent(value: unknown): value is ShortLinkClickEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (SHORT_LINK_CLICK_TYPES as readonly string[]).includes(String(v.type)) &&
    typeof v.source === 'string' &&
    CLICK_SOURCE_PATTERN.test(v.source)
  );
}

/** Crawlers, link previewers and monitors (the user agent is only matched, never kept). */
export const CRAWLER_USER_AGENT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|slack|curl|wget|python|go-http|headless|lighthouse|pagespeed|uptime|monitor/i;

export function isCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  return CRAWLER_USER_AGENT.test(userAgent ?? '');
}
