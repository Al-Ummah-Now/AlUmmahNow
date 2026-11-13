/**
 * The anonymous first page of GET /api/videos is cached briefly on the edge
 * (endpoints/video/videoList.ts): it is the same for every visitor and costs an
 * R2 read per video. A video deleted, hidden, made private or rescheduled stayed
 * in that page until the entry expired: visitors saw (and their browsers
 * requested thumbnails of) videos that were gone, and a video made private was
 * still listed (#1131).
 *
 * Every first-page key carries a generation stamp; a request that changes what
 * the list shows bumps it, so every cached variant (limit, sort, filter,
 * category) is dropped at once. The Cache API is per colo: the colo that served
 * the change sees it at once, the others within the entry's short TTL.
 */
import type { MiddlewareHandler } from 'hono';
import { edgeCacheUrl, readEdgeCache, writeEdgeCache } from './edge-cache';

type WaitUntil = ((promise: Promise<unknown>) => void) | null;

/** How long the anonymous first page is reused */
export const FIRST_PAGE_TTL_SECONDS = 30;
/** Outlives every first-page entry by far; an evicted stamp only means a fresh one */
const GENERATION_TTL_SECONDS = 24 * 3600;

function generationUrl(requestUrl: string): string {
  return edgeCacheUrl(requestUrl, 'videos/v1/first-page-generation');
}

/** The current generation stamp ('0' before any change was seen in this colo). */
export async function videoListGeneration(requestUrl: string): Promise<string> {
  const stamp = await readEdgeCache<{ generation?: string }>(generationUrl(requestUrl));
  return stamp?.generation || '0';
}

/** Drops every cached first page (in this colo). Fails open. */
export function bumpVideoListGeneration(requestUrl: string, waitUntil: WaitUntil): void {
  const generation = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 8)}`;
  writeEdgeCache(generationUrl(requestUrl), { generation }, GENERATION_TTL_SECONDS, waitUntil);
}

const VIDEO_ID = '[^/]+';

/**
 * Requests that can change which videos the list shows, or how a card looks
 * (title, thumbnail): deletes and restores, edits (visibility included),
 * thumbnails, schedules, bulk edits, admin and moderation actions. Views,
 * likes, comments, chapters and subtitles do not, so they keep the cache.
 */
const LIST_CHANGES: Array<{ methods: string[]; path: RegExp }> = [
  { methods: ['PUT', 'DELETE'], path: new RegExp(`^/api/videos/${VIDEO_ID}$`) },
  { methods: ['DELETE'], path: new RegExp(`^/api/videos/${VIDEO_ID}/permanent$`) },
  { methods: ['POST'], path: new RegExp(`^/api/videos/${VIDEO_ID}/(restore|thumbnail|publish-now)$`) },
  { methods: ['PATCH', 'DELETE'], path: new RegExp(`^/api/videos/${VIDEO_ID}/schedule$`) },
  { methods: ['PATCH'], path: /^\/api\/videos\/bulk$/ },
  { methods: ['POST'], path: /^\/api\/videos\/(bulk\/undo|bulk-(delete|update|schedule|restore|purge))$/ },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], path: /^\/api\/moderation\// },
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], path: /^\/internal\/admin\/(videos|deletions|channels|users)\// },
];

export function changesVideoList(method: string, path: string): boolean {
  const m = method.toUpperCase();
  return LIST_CHANGES.some((rule) => rule.methods.includes(m) && rule.path.test(path));
}

/** After a successful list-changing request, drop the cached first pages. */
export const videoListInvalidation: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.res.status >= 400 || !changesVideoList(c.req.method, new URL(c.req.url).pathname)) return;
  let waitUntil: WaitUntil = null;
  try {
    const ctx = c.executionCtx;
    waitUntil = (promise) => ctx.waitUntil(promise);
  } catch {
    // no execution context (tests)
  }
  bumpVideoListGeneration(c.req.url, waitUntil);
};
