/**
 * A matched URL → the item that serves it and its uploader (docs/specs/CSAM-RESPONSE.md §3).
 *
 * parseCsamUrl (shared-types) reads what the URL itself says; this module looks the rest up: the
 * video record for media and thumbnails, the post for a post image, and the image_owners index for
 * avatars and covers (whose paths carry only a random id). Anything not found is `unmapped`: the
 * case still opens and a super admin maps it by hand. A record an account erasure deleted is found by what
 * the erasure wrote down, while its media is still there (lib/privacy/erase-targets.ts): without an uploader.
 */
import { parseCsamUrl, type CsamResolution, type CsamUrlTarget } from '@al-ummah/shared-types';
import { resolveHandle, resolveHandleHistory } from '../channelHandles';
import { locatePostComment } from '../channelComments/moderation';
import { postChannelId } from '../community-posts';
import { findStoredComment, type StoredComment } from '../comments';
import { readHost } from '../sites/store';
import { streamKey } from '../live/streams';
import { lookupImageOwner } from './imageOwners';
import { erasedRecord } from '../privacy/erase-targets';
import { isInternalVideoKey } from '@al-ummah/shared-types';

export interface ResolveEnv {
	videos?: R2Bucket;
	profiles?: R2Bucket;
	channels?: R2Bucket;
	community_posts?: R2Bucket;
	/** Channel handles, and the scholar sites' host index */
	channel_tabs?: R2Bucket;
	SEARCH_DB?: D1Database;
}

export type ResolveOutcome = { ok: true; resolution: CsamResolution } | { ok: false; reason: 'not_ours' | 'not_found'; target?: CsamUrlTarget };

async function json<T>(bucket: R2Bucket | undefined, key: string): Promise<T | null> {
	const object = await bucket?.get(key);
	if (!object) return null;
	try {
		return (await object.json()) as T;
	} catch {
		return null;
	}
}

type VideoRow = { userId?: string; channelId?: string | null };

/** An erased video; not an erased stream, which is written down the same way. */
async function erasedVideo(env: ResolveEnv, videoId: string): Promise<VideoRow | null> {
	const erased = isInternalVideoKey(videoId) ? null : await erasedRecord(env.SEARCH_DB, { kind: 'video', id: videoId });
	return erased && !erased.stream ? (erased as VideoRow) : null;
}

async function videoResolution(env: ResolveEnv, videoId: string, kind: 'video' | 'video_thumbnail', target: CsamUrlTarget): Promise<ResolveOutcome> {
	const video = isInternalVideoKey(videoId) ? null : await json<VideoRow>(env.videos, videoId);
	const found = video ?? (await erasedVideo(env, videoId));
	if (!found) return { ok: false, reason: 'not_found', target };
	return { ok: true, resolution: { kind, videoId, channelId: found.channelId ?? null, uploaderId: found.userId ?? null } };
}

/** A profile's account, unless the profile was erased: such a case names no account and freezes none. */
async function existingProfile(env: ResolveEnv, userId: string | null): Promise<string | null> {
	return userId && (!env.profiles || (await env.profiles.head(userId))) ? userId : null;
}

/** The post of a channel that shows this image (a channel's posts, newest pages first). */
async function postShowing(env: ResolveEnv, channelId: string, path: string): Promise<{ postId: string; userId: string | null } | null> {
	if (!env.community_posts) return null;
	let cursor: string | undefined;
	for (let page = 0; page < 20; page++) {
		const listed = await env.community_posts.list({ prefix: `posts/${channelId}/`, limit: 100, ...(cursor ? { cursor } : {}) });
		for (const o of listed.objects) {
			if (o.key.endsWith('/index.json')) continue;
			const post = await json<{ id?: string; userId?: string; images?: Array<{ url?: string }> }>(env.community_posts, o.key);
			if (post?.images?.some((i) => typeof i.url === 'string' && i.url.includes(path))) {
				return { postId: post.id ?? o.key.split('/').pop()!.replace(/\.json$/, ''), userId: post.userId ?? null };
			}
		}
		if (!listed.truncated || !listed.cursor) return null;
		cursor = listed.cursor;
	}
	return null;
}

/**
 * A post by its id. `expectChannel`: what the URL said about its channel; a post that is somewhere
 * else is not what the page showed, so it is left for a person.
 */
async function postResolution(env: ResolveEnv, postId: string, expectChannel: string | null, target: CsamUrlTarget): Promise<ResolveOutcome> {
	const channelId = expectChannel ?? (env.community_posts ? await postChannelId({ community_posts: env.community_posts, SEARCH_DB: env.SEARCH_DB }, postId) : null);
	const stored = channelId ? await json<{ userId?: string }>(env.community_posts, `posts/${channelId}/${postId}.json`) : null;
	const post = stored ?? (channelId ? ((await erasedRecord(env.SEARCH_DB, { kind: 'post', id: `${channelId}/${postId}` })) as { userId?: string } | null) : null);
	if (!post) return { ok: false, reason: 'not_found', target };
	return { ok: true, resolution: { kind: 'post_image', channelId, postId, uploaderId: post.userId ?? null } };
}

/** The comment and its author. Never the video or post it is on, nor whoever made that. */
async function commentResolution(env: ResolveEnv, target: Extract<CsamUrlTarget, { kind: 'comment' }>): Promise<ResolveOutcome> {
	const { on, parentId, commentId } = target;
	let author: string | null | undefined;
	if (on === 'video') {
		const video = await json<{ comments?: StoredComment[] }>(env.videos, parentId);
		author = findStoredComment(video?.comments, commentId)?.comment.userId;
	} else {
		author = env.community_posts ? (await locatePostComment(env.community_posts, parentId, commentId))?.comment.userId : undefined;
	}
	if (author === undefined) return { ok: false, reason: 'not_found', target };
	return { ok: true, resolution: { kind: 'comment', commentId, commentOn: on, commentParentId: parentId, uploaderId: author || null } };
}

async function streamResolution(env: ResolveEnv, streamId: string, target: CsamUrlTarget): Promise<ResolveOutcome> {
	const stored = await json<{ userId?: string; channelId?: string | null }>(env.videos, streamKey(streamId));
	const erased = stored ? null : await erasedRecord(env.SEARCH_DB, { kind: 'video', id: streamId });
	const stream = stored ?? (erased?.stream ? (erased as { userId?: string; channelId?: string | null }) : null);
	if (!stream) return { ok: false, reason: 'not_found', target };
	return { ok: true, resolution: { kind: 'live_stream', streamId, channelId: stream.channelId ?? null, uploaderId: stream.userId ?? null } };
}

/** The stream of a self-hosted live session (the id in the live edge's URLs). */
async function streamOfSession(env: ResolveEnv, sessionId: string): Promise<string | null> {
	const row = await env.SEARCH_DB?.prepare('SELECT stream_id FROM live_sessions WHERE id = ?').bind(sessionId).first<{ stream_id: string }>();
	return row?.stream_id ?? null;
}

async function siteResolution(env: ResolveEnv, target: Extract<CsamUrlTarget, { kind: 'site' }>): Promise<ResolveOutcome> {
	const entry = env.channel_tabs ? await readHost(env as never, target.host) : null;
	// Somebody else's domain: not ours, whatever its paths look like
	if (!entry && !target.ours) return { ok: false, reason: 'not_ours' };
	if (!entry || !target.item || !target.id) return { ok: false, reason: 'not_found', target };
	const found = target.item === 'video' ? await videoResolution(env, target.id, 'video', target) : await postResolution(env, target.id, entry.channelId, target);
	// A site shows its own channel only: another channel's item was not on that page
	if (found.ok && found.resolution.channelId !== entry.channelId) return { ok: false, reason: 'not_found', target };
	// A comment on it: the comment, never the item
	if (found.ok && target.commentId) return commentResolution(env, { kind: 'comment', on: target.item, parentId: target.id, commentId: target.commentId });
	return found;
}

export async function resolveCsamUrl(env: ResolveEnv, input: string): Promise<ResolveOutcome> {
	const target = parseCsamUrl(input);
	if (!target) return { ok: false, reason: 'not_ours' };
	switch (target.kind) {
		case 'video':
			return videoResolution(env, target.videoId, 'video', target);
		case 'video_thumbnail':
			return videoResolution(env, target.videoId, 'video_thumbnail', target);
		case 'page': {
			if (target.page === 'video' || target.page === 'shorts' || target.page === 'embed') return videoResolution(env, target.id, 'video', target);
			if (target.page === 'post') {
				let channelId = target.id;
				if (target.handle) {
					channelId = env.channel_tabs ? ((await resolveHandle(env.channel_tabs, target.handle)) ?? (await resolveHandleHistory(env.channel_tabs, target.handle))) : null;
					if (!channelId) return { ok: false, reason: 'not_found', target };
				}
				return postResolution(env, target.postId, channelId, target);
			}
			// A channel page shows several images: which one matched is not in the URL
			return { ok: false, reason: 'not_found', target };
		}
		case 'post_image': {
			const indexed = await lookupImageOwner(env.SEARCH_DB, target.path);
			const post = await postShowing(env, target.channelId, target.path);
			const uploaderId = post?.userId ?? indexed?.ownerId ?? null;
			// A file of an erased channel's own folder
			if (!post && !indexed && !(await erasedRecord(env.SEARCH_DB, { kind: 'channel', id: target.channelId }))) return { ok: false, reason: 'not_found', target };
			return { ok: true, resolution: { kind: 'post_image', channelId: target.channelId, imagePath: target.path, ...(post ? { postId: post.postId } : {}), uploaderId } };
		}
		case 'image': {
			const owner = await lookupImageOwner(env.SEARCH_DB, target.path);
			if (!owner) return { ok: false, reason: 'not_found', target };
			if (owner.kind === 'profile_avatar' || owner.kind === 'profile_cover') {
				return { ok: true, resolution: { kind: 'profile_image', imagePath: target.path, imageField: owner.kind === 'profile_avatar' ? 'avatarUrl' : 'coverUrl', channelId: null, uploaderId: await existingProfile(env, owner.ownerId) } };
			}
			if (owner.kind === 'channel_avatar' || owner.kind === 'channel_cover') {
				return {
					ok: true,
					resolution: { kind: 'channel_image', imagePath: target.path, imageField: owner.kind === 'channel_avatar' ? 'avatarUrl' : 'coverUrl', channelId: owner.channelId, uploaderId: owner.ownerId },
				};
			}
			if (owner.kind === 'post_image') return { ok: true, resolution: { kind: 'post_image', imagePath: target.path, channelId: owner.channelId, uploaderId: owner.ownerId } };
			return { ok: false, reason: 'not_found', target };
		}
		case 'comment':
			return commentResolution(env, target);
		case 'live_stream':
			return streamResolution(env, target.streamId, target);
		case 'live_session': {
			const streamId = await streamOfSession(env, target.sessionId);
			return streamId ? streamResolution(env, streamId, target) : { ok: false, reason: 'not_found', target };
		}
		case 'site':
			return siteResolution(env, target);
		case 'other':
			return { ok: false, reason: 'not_found', target };
	}
}

/** A super admin's hand mapping of an unmapped case (validated against the stores). */
export async function resolveByHand(
	env: ResolveEnv,
	input: { kind: 'video'; videoId: string } | { kind: 'post'; channelId: string; postId: string } | { kind: 'profile_image' | 'channel_image'; id: string; field: 'avatarUrl' | 'coverUrl' },
): Promise<CsamResolution | null> {
	if (input.kind === 'video') {
		const v = isInternalVideoKey(input.videoId) ? null : ((await json<VideoRow>(env.videos, input.videoId)) ?? (await erasedVideo(env, input.videoId)));
		return v ? { kind: 'video', videoId: input.videoId, channelId: v.channelId ?? null, uploaderId: v.userId ?? null } : null;
	}
	if (input.kind === 'post') {
		const p = (await json<{ userId?: string }>(env.community_posts, `posts/${input.channelId}/${input.postId}.json`)) ?? ((await erasedRecord(env.SEARCH_DB, { kind: 'post', id: `${input.channelId}/${input.postId}` })) as { userId?: string } | null);
		return p ? { kind: 'post_image', channelId: input.channelId, postId: input.postId, uploaderId: p.userId ?? null } : null;
	}
	if (input.kind === 'channel_image') {
		const ch = (await json<Record<string, any>>(env.channels, input.id)) ?? (await erasedRecord(env.SEARCH_DB, { kind: 'channel', id: input.id }));
		const url = ch?.[input.field] ?? ch?.pendingImages?.[input.field]?.url;
		const path = typeof url === 'string' ? new URL(url).pathname : undefined;
		return ch ? { kind: 'channel_image', channelId: input.id, imageField: input.field, ...(path ? { imagePath: path } : {}), uploaderId: ch.userId ?? null } : null;
	}
	const stored = await json<Record<string, any>>(env.profiles, input.id);
	const profile = stored ?? (await erasedRecord(env.SEARCH_DB, { kind: 'user', id: input.id }));
	if (!profile) return null;
	const url = profile[input.field] ?? profile.pendingImages?.[input.field]?.url;
	const path = typeof url === 'string' ? new URL(url).pathname : undefined;
	// An erased profile's is found by the image alone
	if (!stored && !path) return null;
	return { kind: 'profile_image', imageField: input.field, ...(path ? { imagePath: path } : {}), channelId: null, uploaderId: stored ? input.id : null };
}
