/**
 * Where a short link goes (wiki AUN-SHORT-LINKS). Each id is looked up through the public videos API
 * as an anonymous visitor, so a deleted, private or unknown item is "not found" and the Worker never
 * learns (or shows) anything a signed-out visitor could not see. Lookups are cached at the edge.
 */
import {
  keptShortLinkParams,
  shortLinkLang,
  type ShortLinkClickType,
  type ShortLinkTarget,
} from '@al-ummah/shared-types';

export interface ResolveEnv {
  /** The videos site, e.g. https://videos.alummahnow.net */
  SITE_ORIGIN: string;
  /** The www home, e.g. https://www.alummahnow.net */
  WWW_ORIGIN: string;
  /** The public videos API, e.g. https://videos.api.alummahnow.net */
  API_ORIGIN: string;
  /** 'shorts' once the site has /shorts/<id> (D-SEO-10); otherwise Shorts open on /video/<id> */
  SHORTS_PATH?: string;
}

/** What the lookup found: the site path of the page (no locale), or null (not found). */
export interface Lookup {
  path: string | null;
  type: ShortLinkClickType;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const trim = (origin: string) => origin.replace(/\/+$/, '');

async function apiJson(env: ResolveEnv, fetchImpl: FetchLike, path: string): Promise<Record<string, unknown> | null> {
  const res = await fetchImpl(`${trim(env.API_ORIGIN)}${path}`, { headers: { Accept: 'application/json' } });
  // 404 (not found, private, deleted) and 410 (purged) are "not found"; anything else is a failure
  if (res.status === 404 || res.status === 410 || res.status === 400) return null;
  if (!res.ok) throw new Error(`lookup ${path.split('/').slice(0, 3).join('/')} answered ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  // Some endpoints wrap the object ({ success, result } / { data })
  const inner = (body.result ?? body.data) as Record<string, unknown> | undefined;
  return inner && typeof inner === 'object' && !Array.isArray(inner) ? inner : body;
}

const enc = encodeURIComponent;

/** Looks the target up and returns the page path on the videos site (or www for home). */
export async function lookupTarget(target: ShortLinkTarget, env: ResolveEnv, fetchImpl: FetchLike): Promise<Lookup> {
  const shortsPath = env.SHORTS_PATH === 'shorts' ? 'shorts' : 'video';
  switch (target.kind) {
    case 'home':
      return { path: '/', type: 'home' };
    case 'video':
    case 'short': {
      const video = await apiJson(env, fetchImpl, `/api/videos/${enc(target.id)}`);
      if (!video) return { path: null, type: target.kind };
      const short = video.isShort === true;
      return { path: `/${short ? shortsPath : 'video'}/${enc(target.id)}`, type: short ? 'short' : 'video' };
    }
    case 'channel': {
      const channel = await apiJson(env, fetchImpl, `/api/channels/${enc(target.id)}`);
      return { path: channel ? `/channels/${enc(target.id)}` : null, type: 'channel' };
    }
    case 'handle': {
      const channel = await apiJson(env, fetchImpl, `/api/channels/by-handle/${enc(target.handle)}`);
      const handle = typeof channel?.handle === 'string' && channel.handle ? channel.handle : target.handle;
      return { path: channel ? `/@${enc(handle.replace(/^@/, ''))}` : null, type: 'channel' };
    }
    case 'playlist': {
      const playlist = await apiJson(env, fetchImpl, `/api/playlists/${enc(target.id)}`);
      return { path: playlist ? `/playlist/${enc(target.id)}` : null, type: 'playlist' };
    }
    case 'post': {
      const post = await apiJson(env, fetchImpl, `/api/community/posts/${enc(target.id)}`);
      const channelId = typeof post?.channelId === 'string' ? post.channelId : null;
      return {
        path: channelId ? `/channels/${enc(channelId)}?tab=community&post=${enc(target.id)}#post-${enc(target.id)}` : null,
        type: 'post',
      };
    }
  }
}

/**
 * The full redirect URL: the site's page with the language (only when the link asks for one with
 * ?lang=; otherwise the site's own default applies) and the kept query parameters.
 */
export function redirectUrl(lookup: Lookup & { path: string }, requestUrl: URL, env: ResolveEnv): string {
  const lang = shortLinkLang(requestUrl.searchParams);
  const origin = trim(lookup.type === 'home' ? env.WWW_ORIGIN : env.SITE_ORIGIN);
  const [pathAndQuery, hash] = lookup.path.split('#') as [string, string | undefined];
  const [path, query] = pathAndQuery.split('?') as [string, string | undefined];
  const localized = lang ? `/${lang}${path === '/' ? '/' : path}` : path;
  const url = new URL(`${origin}${localized}`);
  if (query) for (const [k, v] of new URLSearchParams(query)) url.searchParams.set(k, v);
  for (const [k, v] of keptShortLinkParams(requestUrl.searchParams)) url.searchParams.set(k, v);
  if (hash) url.hash = hash;
  return url.toString();
}
