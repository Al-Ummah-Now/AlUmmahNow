/**
 * Subscribers hear about a new community post (Story 29.4). Every way a post goes live sends
 * CommunityPostCreated (create, "Publish now", the scheduled-posts cron, image review clearing a
 * held post, a CMS article), so this one place decides whether to notify: it reads the post and,
 * if it is really live for subscribers, queues the paged `new_post` NotificationFanout (one page of
 * subscribers per message, bell = all or highlights, the `posts` category respected).
 *
 * A failed read or queue send throws, so the queue retries the message with backoff, then the DLQ
 * and the admin Errors page (dlq/consumer.ts). Repeats are harmless: the fan-out stores one row per
 * subscriber and post (dedupe key `post:<id>`).
 */
import { channelNameParams, isPostHeldByReview, newPostFanout, PostStatus, PostVisibility, type CommunityPost } from '@al-ummah/shared-types';
import { MessageType, type AlUmmahMessage } from '../types';

export interface PostNotifyEnv {
  community_posts?: { get(key: string): Promise<{ json<T = unknown>(): Promise<T> } | null> };
  MESSAGE_QUEUE?: { send(message: AlUmmahMessage): Promise<unknown> };
}

interface Log {
  debug: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

export type PostNotifyOutcome = 'queued' | 'not_live' | 'missing' | 'skipped';

/** Whether subscribers should be told about the post now. */
export function postIsLiveForSubscribers(post: Partial<CommunityPost> & { review?: { status?: string } | null }, now = Date.now()): boolean {
  if (post.status !== PostStatus.PUBLISHED) return false; // scheduled, draft or deleted
  if (post.isDeleted || post.isHidden) return false;
  if (isPostHeldByReview(post)) return false; // announced again when review clears it
  if (post.visibility && post.visibility !== PostVisibility.PUBLIC && post.visibility !== PostVisibility.SUBSCRIBERS) return false;
  const created = post.createdAt ? Date.parse(post.createdAt) : Number.NaN;
  return Number.isNaN(created) || created <= now + 60_000;
}

export async function notifySubscribersOfPost(env: PostNotifyEnv, channelId: string, postId: string, log: Log): Promise<PostNotifyOutcome> {
  if (!env.community_posts || !env.MESSAGE_QUEUE || !ID.test(channelId) || !ID.test(postId)) {
    log.warn('[PostNotify] bucket or queue not bound; subscribers not notified', { channelId, postId });
    return 'skipped';
  }
  const object = await env.community_posts.get(`posts/${channelId}/${postId}.json`);
  if (!object) return 'missing';
  const post = await object.json<CommunityPost & { review?: { status?: string } | null }>();
  if (!postIsLiveForSubscribers(post)) {
    log.debug('[PostNotify] post not live for subscribers; nothing sent', { channelId, postId, status: post.status });
    return 'not_live';
  }
  const payload = newPostFanout(
    { ...post, id: postId, channelId },
    channelNameParams({ name: post.channelName, nameLocalized: post.channelNameLocalized ?? null }),
  );
  await env.MESSAGE_QUEUE.send({
    id: `post-fanout-${postId}`,
    type: MessageType.NotificationFanout,
    timestamp: Date.now(),
    payload: payload as unknown as Record<string, unknown>,
  });
  log.debug('[PostNotify] subscriber fan-out queued', { channelId, postId });
  return 'queued';
}
