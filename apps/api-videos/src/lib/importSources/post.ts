/**
 * One imported item as a community post on the channel (wiki TOOLS-ADMIN TA-9, "How imported items
 * reach the scholar page"): text → a text post, images → an image post (copied to the media host
 * first), a link → a link post, a video → the normal upload, then a video post. The post is the
 * channel's, as if the owner had posted it; it keeps the original's link and time (importedFrom), and
 * goes through the same writer and moderation as a Studio post (lib/community/writePost.ts).
 *
 * Idempotent: the post id is recorded on the item before anything is written, so a retry rewrites the
 * same post; the video is claimed by its file claim (lib/importSources/video.ts).
 */
import {
	PostStatus,
	PostType,
	PostVisibility,
	type Channel,
	type CommunityPost,
	type PostImage,
	type SourceImportedFrom,
} from '@al-ummah/shared-types';
import { channelNameFields } from '../channelName';
import { loadChannelRecord } from '../channelAccess';
import { writeCommunityPost, type WritePostEnv } from '../community/writePost';
import { copyImages, resolveSourceUrl } from './media';
import { claimItemIds, finishItem, SourceError, type ItemRow, type SourceRow, type SourceDbEnv } from './store';
import { initiateImportVideo, markVideoImported, sourceSize, transferImportVideo, type ImportVideoEnv } from './video';
import { itemKind, type FetchedItem } from './fetchers';
import { logger } from '../logger';

export type PostItemEnv = WritePostEnv & ImportVideoEnv & SourceDbEnv & { channels: R2Bucket };

export type PostItemOutcome = { status: 'posted'; postId: string; videoId?: string } | { status: 'skipped'; note: ItemRow['note'] } | { status: 'continue' };

const linkTitle = (item: FetchedItem) => item.link?.title ?? item.title ?? null;

/** The post's own fields for the item (without the ones the channel and the writer fill). */
function postBody(item: FetchedItem, media: { images?: PostImage[]; videoId?: string; linkImage?: PostImage | null }): Partial<CommunityPost> {
	if (media.videoId) return { type: PostType.VIDEO, videoId: media.videoId, content: item.text || undefined };
	if (media.images?.length) return { type: PostType.IMAGE, images: media.images, content: item.text || undefined };
	// A link is only ever a web address (the fetchers check it; checked again here before it is published)
	if (item.link && /^https?:\/\//i.test(item.link.url)) {
		return {
			type: PostType.LINK,
			content: item.text || undefined,
			link: {
				url: item.link.url,
				title: linkTitle(item)?.slice(0, 200) ?? null,
				siteName: null,
				description: item.link.description?.slice(0, 300) ?? null,
				image: media.linkImage ? { url: media.linkImage.url, alt: null, width: media.linkImage.width || null, height: media.linkImage.height || null } : null,
			},
		} as Partial<CommunityPost>;
	}
	return { type: PostType.TEXT, content: item.text };
}

/**
 * Posts the item, or does the next step of its video. The channel must still exist and not be suspended
 * (a suspended channel publishes nothing new); a refusal skips the item with a note.
 */
export async function postItem(env: PostItemEnv, ctx: ExecutionContext, source: SourceRow, row: ItemRow, actorId: string, f: typeof fetch = fetch): Promise<PostItemOutcome> {
	const item = JSON.parse(row.payload ?? '{}') as FetchedItem;
	if (!itemKind(item)) return { status: 'skipped', note: 'empty' };
	const channel = (await loadChannelRecord(env as never, source.channel_id)) as (Channel & { isDeleted?: boolean; isSuspended?: boolean }) | null;
	if (!channel?.userId || channel.isDeleted || channel.isSuspended) throw new SourceError(409, 'channel_unavailable', 'The channel is deleted or suspended');
	const ownerId = channel.userId;
	const key = `${source.id}:${row.item_id}`;
	const importedFrom: SourceImportedFrom = { platform: source.network as SourceImportedFrom['platform'], url: item.url, postedAt: item.postedAt ? new Date(item.postedAt).toISOString() : null, sourceId: source.id };

	const media: { images?: PostImage[]; videoId?: string; linkImage?: PostImage | null } = {};
	if (item.video) {
		let videoId = row.video_id;
		let size = item.video.bytes ?? null;
		if (!size) {
			const resolved = await resolveSourceUrl(env, source.network, item.video.url, f);
			size = resolved ? (resolved.bytes ?? (await sourceSize(resolved.url, null, f).catch(() => null))) : null;
		}
		if (!size) return { status: 'skipped', note: 'media_unavailable' };
		if (!videoId) {
			const title = (item.title || item.text.split('\n')[0] || '').trim();
			({ videoId } = await initiateImportVideo(env, ctx, { channelId: source.channel_id, actorId, sourceId: source.id, itemId: row.item_id, title, description: item.text, bytes: size, mimeType: item.video.mimeType ?? 'video/mp4' }));
			await claimItemIds(env, source.id, row.item_id, { videoId });
			await markVideoImported(env, videoId, ownerId, importedFrom);
		}
		const transfer = await transferImportVideo(env, { videoId, actorId, sourceId: source.id, network: source.network, itemId: row.item_id, video: item.video, bytes: size }, f);
		if (transfer.status === 'continue') return { status: 'continue' };
		if (transfer.status === 'skipped') return { status: 'skipped', note: transfer.note };
		media.videoId = videoId;
	} else if (item.images.length) {
		media.images = await copyImages(env, { channelId: source.channel_id, network: source.network, ownerId, key, images: item.images }, f);
		if (!media.images.length && !item.text.trim()) return { status: 'skipped', note: 'media_unavailable' };
	} else if (item.link?.image) {
		media.linkImage = (await copyImages(env, { channelId: source.channel_id, network: source.network, ownerId, key: `${key}:link`, images: [{ url: item.link.image }] }, f))[0] ?? null;
	}

	const postId = row.post_id ?? crypto.randomUUID();
	if (!row.post_id) await claimItemIds(env, source.id, row.item_id, { postId });
	const now = new Date().toISOString();
	const post: CommunityPost = {
		id: postId,
		channelId: source.channel_id,
		userId: ownerId,
		...(postBody(item, media) as Pick<CommunityPost, 'type'>),
		likes: 0,
		comments: 0,
		shares: 0,
		views: 0,
		createdAt: now,
		pinned: false,
		status: PostStatus.PUBLISHED,
		visibility: PostVisibility.PUBLIC,
		commentsEnabled: true,
		...channelNameFields(channel),
		channelAvatar: channel.avatarUrl,
		channelVerified: channel.isVerified || false,
		importedFrom,
	};
	// A retry keeps the post as first written (its time, its counters)
	const existing = await env.community_posts.get(`posts/${source.channel_id}/${postId}.json`);
	if (existing) {
		logger.debug('[ImportSources] Post already written', { sourceId: source.id, itemId: row.item_id, postId });
	} else {
		await writeCommunityPost({ env, executionCtx: ctx }, post, { userId: actorId });
	}
	await finishItem(env, source.id, row.item_id, { state: 'posted' });
	return { status: 'posted', postId, ...(media.videoId ? { videoId: media.videoId } : {}) };
}

/** Records a skipped item (the post or upload was refused, or the media is gone). */
export async function skipItem(env: SourceDbEnv, source: SourceRow, row: ItemRow, note: ItemRow['note']): Promise<void> {
	await finishItem(env, source.id, row.item_id, { state: 'skipped', note });
}
