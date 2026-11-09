/**
 * Prototype only: applies demo-filter.ts to API calls on theme demo builds.
 * Patching fetch keeps the filter out of the UI and the API helpers, which
 * call the API from both the worker and the browser. Inert on normal builds.
 */
import demoSet from '../../../demo-content/demo-set.json';
import {
  buildPoolVideos,
  isUsableDemoSet,
  routeDemoRequest,
  type DemoChannel,
  type DemoPool,
  type DemoSet,
  type DemoVideo, isTestComment } from './demo-filter';

const PROXY_PREFIX = '/api/qa-proxy';
const POOL_TTL_MS = 30_000;
const MAX_CHANNEL_PAGES = 3;

type Fetch = typeof globalThis.fetch;

/** Where the pool is read from: the API origin on the worker, the same-origin proxy in the browser. */
function apiBase(): string {
  if (typeof window !== 'undefined') return PROXY_PREFIX;
  return (process.env.API_URL ?? '').replace(/\/$/, '');
}

/** The API path of a request URL, or null when it is not an API call. */
export function apiPathOf(rawUrl: string, apiUrl: string | undefined): URL | null {
  const url = new URL(rawUrl, 'http://demo.invalid');
  if (url.pathname.startsWith(`${PROXY_PREFIX}/`)) {
    return new URL(`${url.pathname.slice(PROXY_PREFIX.length)}${url.search}`, 'http://demo.invalid');
  }
  if (apiUrl && url.origin === new URL(apiUrl).origin) return url;
  return null;
}

async function getJson<T>(fetcher: Fetch, url: string): Promise<T | null> {
  const response = await fetcher(url, { cache: 'no-store' });
  return response.ok ? ((await response.json()) as T) : null;
}

async function loadChannelVideos(fetcher: Fetch, base: string, channelId: string): Promise<DemoVideo[]> {
  const videos: DemoVideo[] = [];
  let cursor = '';
  for (let i = 0; i < MAX_CHANNEL_PAGES; i++) {
    const query = `channelId=${encodeURIComponent(channelId)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = await getJson<{ data?: DemoVideo[]; cursor?: string }>(fetcher, `${base}/api/videos?${query}`);
    videos.push(...(body?.data ?? []));
    cursor = body?.cursor ?? '';
    if (!cursor) break;
  }
  return videos;
}

async function loadPool(fetcher: Fetch, set: DemoSet): Promise<DemoPool> {
  const base = apiBase();
  const [lists, extras, channels] = await Promise.all([
    Promise.all(set.channels.map((id) => loadChannelVideos(fetcher, base, id))),
    Promise.all(set.extraVideos.map((id) => getJson<DemoVideo>(fetcher, `${base}/api/videos/${encodeURIComponent(id)}`))),
    Promise.all(set.channels.map((id) => getJson<DemoChannel>(fetcher, `${base}/api/channels/${encodeURIComponent(id)}`))),
  ]);
  return {
    videos: buildPoolVideos(set, [...lists, extras.filter((video): video is DemoVideo => Boolean(video))]),
    channels: channels.filter((channel): channel is DemoChannel => Boolean(channel?.id)),
  };
}

function poolReader(fetcher: Fetch, set: DemoSet): () => Promise<DemoPool> {
  let cached: { at: number; pool: Promise<DemoPool> } | null = null;
  return () => {
    if (cached && Date.now() - cached.at < POOL_TTL_MS) return cached.pool;
    const pool = loadPool(fetcher, set);
    const entry = { at: Date.now(), pool };
    cached = entry;
    pool.catch(() => {
      if (cached === entry) cached = null;
    });
    return pool;
  };
}

function json(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers });
}

type DemoPlaylist = { id?: string; thumbnailUrl?: string | null; cover?: unknown };

/** QA's API has no derived covers yet, so a playlist without an image borrows its first video's thumbnail. */
async function withFallbackCovers(fetcher: Fetch, rawUrl: string, body: unknown): Promise<unknown> {
  const data = (body as { data?: DemoPlaylist[] })?.data;
  const items: DemoPlaylist[] = Array.isArray(data) ? data : [(body as DemoPlaylist)];
  const at = rawUrl.indexOf('/api/qa-proxy/') >= 0 ? rawUrl.indexOf('/api/qa-proxy/') + '/api/qa-proxy'.length : rawUrl.indexOf('/api/');
  const base = rawUrl.slice(0, at);
  await Promise.all(items.map(async (p) => {
    if (!p?.id || p.thumbnailUrl || p.cover) return;
    const full = await getJson<{ videoItems?: { id?: string; thumbnailUrl?: string }[]; result?: { videoItems?: { id?: string; thumbnailUrl?: string }[] } }>(fetcher, `${base}/api/playlists/${encodeURIComponent(p.id)}?includeVideos=true`);
    const first = (full?.videoItems ?? full?.result?.videoItems)?.[0];
    if (first?.thumbnailUrl) p.cover = { videoId: first.id, thumbnailUrl: first.thumbnailUrl };
  }));
  return body;
}

/** The stored count includes test comments the demo hides, so count what a viewer can actually see. */
async function withVisibleCommentCount(fetcher: Fetch, rawUrl: string, response: Response): Promise<Response> {
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return response;
  const body = (await response.json()) as Record<string, unknown>;
  const video = ('commentsCount' in body ? body : (body.result ?? body.data ?? body)) as Record<string, unknown>;
  if (Number(video.commentsCount) > 0) {
    const url = rawUrl.replace(/(\/api\/videos\/[^/?#]+).*$/, '$1/comments?limit=100');
    const list = await getJson<{ result?: { comments?: { text?: unknown }[] } }>(fetcher, url);
    if (list?.result?.comments) video.commentsCount = list.result.comments.filter((c) => !isTestComment(c.text)).length;
  }
  return json(body, response);
}

export function createDemoFetch(original: Fetch, set: DemoSet, apiUrl: () => string | undefined): Fetch {
  const readPool = poolReader(original, set);
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const rawUrl = request ? request.url : String(input);
    const target = apiPathOf(rawUrl, apiUrl());
    if (!target) return original(input, init);

    const headers = new Headers(init?.headers ?? request?.headers);
    const route = routeDemoRequest(set, {
      method: (init?.method ?? request?.method ?? 'GET').toUpperCase(),
      pathname: target.pathname,
      search: target.searchParams,
      authenticated: headers.has('authorization'),
      channelHeader: Boolean(headers.get('channelid')),
    });
    if (/^\/api\/videos\/[^/]+$/.test(target.pathname) && (init?.method ?? request?.method ?? 'GET').toUpperCase() === 'GET') {
      return withVisibleCommentCount(original, rawUrl, await original(input, init));
    }
    if (route.kind === 'none') return original(input, init);
    if (route.kind === 'replace') return json(route.respond(await readPool()));
    const needsCovers = /^\/api\/(playlists(\/[^/]+)?|channels\/[^/]+\/playlists)$/.test(target.pathname);

    const response = await original(input, init);
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return response;
    const transformed = route.transform(await response.json(), await readPool());
    return json(needsCovers ? await withFallbackCovers(original, rawUrl, transformed) : transformed, response);
  };
}

/** Called once from the API URL module. Does nothing unless this is a seeded demo build. */
export function installDemoFetch(): void {
  const set = demoSet as DemoSet;
  const marked = globalThis as typeof globalThis & { __demoFetchInstalled?: boolean };
  if (process.env.NEXT_PUBLIC_DEMO_CONTENT !== '1' || marked.__demoFetchInstalled || !isUsableDemoSet(set)) return;
  marked.__demoFetchInstalled = true;
  globalThis.fetch = createDemoFetch(globalThis.fetch.bind(globalThis), set, () => process.env.API_URL);
}
