/**
 * Writes to a community post JSON (`posts/<channelId>/<postId>.json`) that
 * other writers share: comments, likes, poll counts, edits, deletes. Each one
 * changes only its own field on the fresh object with a conditional write
 * (SCALABILITY-AUDIT AV-9), so none of them undoes another's.
 */
import R2Repository from './r2Repo';
import { can, channelRoleOf } from '@al-ummah/shared-types';

/** Adds `delta` to the post's `comments` count (never below 0). Resolves false when the post is gone. */
export async function bumpPostComments(bucket: R2Bucket, postKey: string, delta: number): Promise<boolean> {
	const saved = await new R2Repository<{ comments?: number }>(bucket).updateObject(postKey, (post) => {
		post.comments = Math.max(0, (Number(post.comments) || 0) + delta);
	});
	return saved !== null;
}

/**
 * Whether `viewerId` manages the channel's posts: its owner, or a member
 * whose channel role grants post.manage (docs/specs/CHANNEL-ROLES.md). They
 * see scheduled and held posts, and who wrote each one (`authorId`).
 */
export async function managesChannelPosts(channels: R2Bucket | undefined, channelId: string, viewerId: string | null | undefined): Promise<boolean> {
	if (!channels || !viewerId) return false;
	const object = await channels.get(channelId);
	if (!object) return false;
	const channel = (await object.json()) as { userId?: string; members?: unknown } | null;
	return can(channelRoleOf(channel, viewerId), 'post.manage');
}

/** A post as a viewer sees it: `authorId` only for those who manage the channel's posts. */
export function postForViewer<T extends { authorId?: string }>(post: T, manager: boolean): T {
	if (manager || post.authorId === undefined) return post;
	const { authorId: _authorId, ...rest } = post;
	return rest as T;
}

/**
 * Whether a channel is deleted (an admin soft delete keeps it, hidden and
 * restorable, for 30 days): its posts are not shown meanwhile.
 */
export async function isChannelDeleted(channels: R2Bucket | undefined, channelId: string): Promise<boolean> {
	if (!channels) return false;
	const object = await channels.get(channelId);
	if (!object) return false;
	const channel = (await object.json()) as { isDeleted?: boolean } | null;
	return channel?.isDeleted === true;
}

/**
 * Where a post lives, by its id alone (`post-locations/<postId>` → `{ channelId }`), for the post
 * permalink /{locale}/post/{id} and short links (wiki AUN-SEO). The search index finds most posts;
 * this also finds the ones it leaves out (an image, GIF or video with no text). Never a visibility
 * answer: readers still check the post itself.
 */
export const postLocationKey = (postId: string) => `post-locations/${postId}`;

export async function rememberPostLocation(bucket: R2Bucket, postId: string, channelId: string): Promise<void> {
	await bucket.put(postLocationKey(postId), JSON.stringify({ channelId }), { httpMetadata: { contentType: 'application/json' } });
}

export async function readPostLocation(bucket: R2Bucket, postId: string): Promise<string | null> {
	const object = await bucket.get(postLocationKey(postId));
	const record = object ? ((await object.json().catch(() => null)) as { channelId?: unknown } | null) : null;
	const channelId = record?.channelId;
	return typeof channelId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(channelId) ? channelId : null;
}

/** The channel a post was published on, from its id alone: the search index, else its location record. */
export async function postChannelId(env: { community_posts: R2Bucket; SEARCH_DB?: D1Database }, postId: string): Promise<string | null> {
	const row = env.SEARCH_DB ? await env.SEARCH_DB.prepare('SELECT channel_id FROM search_posts WHERE id = ?1').bind(postId).first<{ channel_id: string | null }>() : null;
	return row?.channel_id || (await readPostLocation(env.community_posts, postId));
}
