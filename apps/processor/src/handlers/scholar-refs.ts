/**
 * The scholar post reference outbox (wiki AUN-SCHOLAR-SITES §6.3, SS6/SS8): every create, edit or
 * delete of a community post tells the CMS, which keeps a hidden www reference for each public post
 * on a scholar's PRIMARY channel (posts with ref_post_id), so the post is on the scholar's www page,
 * in search and the sitemap, and editors can feature it. No opt-out: editors decide what to feature.
 *
 * The CMS decides whether the channel is a scholar's primary channel (one indexed read) and answers
 * `ignored` otherwise, so nothing here keeps a list of scholar channels. Failures throw and the queue
 * retries with backoff (then the DLQ and the admin Errors page), the same contract as the CMS's old
 * community_links outbox, in the opposite direction.
 *
 *   PUT    {CMS_INTERNAL_URL}/internal/refs/:postId  { channelId, post } → { status: 'ok', url, slug, locale } | { status: 'ignored' }
 *   DELETE {CMS_INTERNAL_URL}/internal/refs/:postId?channelId=…       → { status: 'ok' | 'ignored' }
 * Both with X-API-Key = INTERNAL_API_KEY (the CMS holds it as VIDEOS_INTERNAL_API_KEY).
 *
 * When www gives the post an address, it is written back onto the post (`www`, and `article.url`
 * for articles), so the videos site can link to it. That write never sends a queue message.
 */
import { isPublicPost, type PostLike } from '@al-ummah/shared-types';
import { getApiKey } from '../lib/websocket-notify';

/** The bits of the community_posts bucket this needs (the processor types R2 loosely). */
export interface PostsBucket {
  get(key: string): Promise<{ json<T = unknown>(): Promise<T>; etag?: string } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string }; onlyIf?: { etagMatches?: string } }): Promise<unknown>;
}

export interface ScholarRefEnv {
  community_posts: PostsBucket;
  CMS_INTERNAL_URL?: string;
  INTERNAL_API_KEY?: string | { get: () => Promise<string> };
}

interface Log {
  debug: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const TIMEOUT_MS = 10_000;

/** A failure the queue should retry (network, 5xx, 429). */
export class RefSyncRetry extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefSyncRetry';
  }
}

export type RefSyncOutcome = 'skipped' | 'ignored' | 'upserted' | 'removed' | 'refused';

export async function syncScholarRef(env: ScholarRefEnv, channelId: string, postId: string, log: Log, fetcher: typeof fetch = fetch): Promise<RefSyncOutcome> {
  const base = env.CMS_INTERNAL_URL?.replace(/\/+$/, '');
  if (!base || !ID.test(channelId) || !ID.test(postId)) return 'skipped';
  const key = await getApiKey(env.INTERNAL_API_KEY as never);
  if (!key) {
    log.warn('[ScholarRefs] INTERNAL_API_KEY not configured; reference not synced', { channelId, postId });
    return 'skipped';
  }
  const objectKey = `posts/${channelId}/${postId}.json`;
  const object = await env.community_posts.get(objectKey);
  const post = object ? ((await object.json()) as PostLike & { isDeleted?: boolean }) : null;
  const live = !!post && !post.isDeleted && isPublicPost(post);
  const url = `${base}/internal/refs/${encodeURIComponent(postId)}${live ? '' : `?channelId=${encodeURIComponent(channelId)}`}`;
  let res: Response;
  try {
    res = await fetcher(url, {
      method: live ? 'PUT' : 'DELETE',
      headers: { 'X-API-Key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: live ? JSON.stringify({ channelId, post }) : null,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new RefSyncRetry(`CMS unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (res.status === 429 || res.status >= 500) throw new RefSyncRetry(`CMS answered ${res.status}`);
  if (!res.ok) {
    // A refusal (bad post, unknown route on an old CMS): retrying would not help.
    log.warn('[ScholarRefs] CMS refused the reference', { channelId, postId, status: res.status });
    return 'refused';
  }
  const answer = (await res.json().catch(() => ({}))) as { status?: string; url?: string; slug?: string; locale?: string };
  if (answer.status === 'ignored') return 'ignored';
  if (!live) return 'removed';
  if (typeof answer.url === 'string' && /^https:\/\//.test(answer.url) && typeof answer.slug === 'string' && (answer.locale === 'en' || answer.locale === 'ar')) {
    await writeBackWww(env.community_posts, objectKey, { url: answer.url, slug: answer.slug, locale: answer.locale });
  }
  log.debug('[ScholarRefs] reference synced', { channelId, postId });
  return 'upserted';
}

/** Records www's address on the post (conditional write: never undoes a concurrent edit). */
async function writeBackWww(bucket: PostsBucket, key: string, www: { url: string; slug: string; locale: 'en' | 'ar' }): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const object = await bucket.get(key);
    if (!object) return;
    const post = (await object.json()) as PostLike & { www?: typeof www };
    const same = post.www?.url === www.url && post.www?.slug === www.slug && post.www?.locale === www.locale && (!post.article || post.article.url === www.url);
    if (same) return;
    post.www = www;
    if (post.article) post.article.url = www.url;
    const written = await bucket.put(key, JSON.stringify(post), { httpMetadata: { contentType: 'application/json' }, ...(object.etag ? { onlyIf: { etagMatches: object.etag } } : {}) });
    if (written) return;
  }
}
