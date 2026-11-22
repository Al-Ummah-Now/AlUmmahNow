/**
 * Writing a community post, shared by Studio (endpoints/community/create-post.ts) and the social import
 * (lib/importSources/post.ts, wiki TOOLS-ADMIN TA-9), so an imported item goes through the same post
 * rules and moderation as one written in Studio: the pre-publication image gate and image scan
 * (VR16), the text scan, the permalink location, the channel's post index, the scheduled-post marker
 * and the CommunityPostCreated message (notifications, social announcements).
 *
 * The caller has checked who may post and built the post; this stores it.
 */
import { PostStatus, type CommunityPost } from '@al-ummah/shared-types';
import { rememberPostLocation } from '../community-posts';
import Queue, { MessageType } from '../queue';
import R2Repository from '../r2Repo';
import { scanInBackground, communityPostScanText } from '../moderation-scan';
import { imageGate, queueImageScan } from '../review/images';
import { markScheduled } from '../scheduled-posts';
import type { WaitUntilContext } from '../websocket-notify';

export interface WritePostEnv {
	community_posts: R2Bucket;
	queue: unknown;
	MODERATION_QUEUE?: { send(message: unknown): Promise<unknown> };
	[binding: string]: unknown;
}

/** The image URLs a post shows (its images and poll option images), for the image gate. */
export function postImageUrls(post: Pick<CommunityPost, 'images' | 'poll'>): string[] {
	const images = (post.images ?? []).map((img) => (img as { url?: string }).url);
	const options = ((post as { poll?: { options?: Array<{ image?: { url?: string } | string }> } }).poll?.options ?? []).map((o) =>
		typeof o.image === 'string' ? o.image : o.image?.url,
	);
	return [...images, ...options].filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u));
}

/** Adds the post to the front of its channel's index (newest first, at most 1000 ids). */
export async function addToChannelIndex(bucket: R2Bucket, channelId: string, postId: string): Promise<void> {
	type PostIndex = { postIds: string[]; lastUpdated: string };
	// Conditional write: posts created at the same time must not drop each other from the index
	await new R2Repository<PostIndex>(bucket).updateObject(
		`posts/${channelId}/index.json`,
		(index) => {
			index.postIds = [postId, ...index.postIds.filter((id) => id !== postId)].slice(0, 1000);
			index.lastUpdated = new Date().toISOString();
		},
		{ initial: () => ({ postIds: [], lastUpdated: new Date().toISOString() }) },
	);
}

/**
 * Stores a new post and starts its checks. Safe to call again with the same post (a retried import):
 * the object, the location and the index entry are rewritten in place.
 */
export async function writeCommunityPost(
	c: WaitUntilContext & { env: WritePostEnv },
	post: CommunityPost,
	actor: { userId: string; channelId?: string },
): Promise<CommunityPost> {
	const env = c.env;
	const channelId = post.channelId;
	// Pre-publication review of post images (VR16): the whole post waits for the check
	const imageUrls = postImageUrls(post);
	const gate = imageUrls.length ? await imageGate(env as never) : null;
	const reviewId = crypto.randomUUID();
	if (gate?.holds) (post as { review?: unknown }).review = { status: 'checking', reviewId, timing: 'pre', since: new Date().toISOString() };

	await env.community_posts.put(`posts/${channelId}/${post.id}.json`, JSON.stringify(post));
	// Its permalink finds it by id alone (lib/community-posts.ts)
	await rememberPostLocation(env.community_posts, post.id, channelId);
	await addToChannelIndex(env.community_posts, channelId, post.id);

	// A scheduled post goes live from the every-minute cron (lib/scheduled-posts.ts, #1218)
	if (post.status === PostStatus.SCHEDULED && post.scheduledAt) {
		await markScheduled(env.community_posts, channelId, post.id, post.scheduledAt);
	}
	if (gate?.scans) {
		await queueImageScan(env as never, gate, { subject: 'post', subjectId: `${channelId}/${post.id}`, reviewId, ownerId: post.userId, channelId, images: imageUrls.slice(0, 10), text: communityPostScanText(post) });
	}
	// Notifications and social (if published; a post held for review is announced when it clears)
	if (post.status === PostStatus.PUBLISHED && !gate?.holds) {
		await new Queue(env.queue as never).send(MessageType.CommunityPostCreated, {
			postId: post.id,
			channelId,
			actor,
			timestamp: post.createdAt,
		});
	}
	scanInBackground(c as never, { surface: 'community_post', event: 'create', subjectId: post.id, authorId: actor.userId, channelId, text: communityPostScanText(post) });
	return post;
}
