/**
 * A matched URL → the item that serves it and its uploader (docs/specs/CSAM-RESPONSE.md §3).
 *
 * parseCsamUrl (shared-types) reads what the URL itself says; this module looks the rest up: the
 * video record for media and thumbnails, the post for a post image, and the image_owners index for
 * avatars and covers (whose paths carry only a random id). Anything not found is `unmapped`: the
 * case still opens and a super admin maps it by hand.
 */
import { parseCsamUrl, type CsamResolution, type CsamUrlTarget } from '@al-ummah/shared-types';
import { lookupImageOwner } from './imageOwners';

export interface ResolveEnv {
	videos?: R2Bucket;
	profiles?: R2Bucket;
	channels?: R2Bucket;
	community_posts?: R2Bucket;
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

async function videoResolution(env: ResolveEnv, videoId: string, kind: 'video' | 'video_thumbnail', target: CsamUrlTarget): Promise<ResolveOutcome> {
	const video = await json<VideoRow>(env.videos, videoId);
	if (!video) return { ok: false, reason: 'not_found', target };
	return { ok: true, resolution: { kind, videoId, channelId: video.channelId ?? null, uploaderId: video.userId ?? null } };
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
			if (target.page === 'post' && target.postId) {
				const post = await json<{ userId?: string }>(env.community_posts, `posts/${target.id}/${target.postId}.json`);
				if (!post) return { ok: false, reason: 'not_found', target };
				return { ok: true, resolution: { kind: 'post_image', channelId: target.id, postId: target.postId, uploaderId: post.userId ?? null } };
			}
			// A channel page shows several images: which one matched is not in the URL
			return { ok: false, reason: 'not_found', target };
		}
		case 'post_image': {
			const indexed = await lookupImageOwner(env.SEARCH_DB, target.path);
			const post = await postShowing(env, target.channelId, target.path);
			const uploaderId = post?.userId ?? indexed?.ownerId ?? null;
			if (!post && !indexed) return { ok: false, reason: 'not_found', target };
			return { ok: true, resolution: { kind: 'post_image', channelId: target.channelId, imagePath: target.path, ...(post ? { postId: post.postId } : {}), uploaderId } };
		}
		case 'image': {
			const owner = await lookupImageOwner(env.SEARCH_DB, target.path);
			if (!owner) return { ok: false, reason: 'not_found', target };
			if (owner.kind === 'profile_avatar' || owner.kind === 'profile_cover') {
				return { ok: true, resolution: { kind: 'profile_image', imagePath: target.path, imageField: owner.kind === 'profile_avatar' ? 'avatarUrl' : 'coverUrl', channelId: null, uploaderId: owner.ownerId } };
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
	}
}

/** A super admin's hand mapping of an unmapped case (validated against the stores). */
export async function resolveByHand(
	env: ResolveEnv,
	input: { kind: 'video'; videoId: string } | { kind: 'post'; channelId: string; postId: string } | { kind: 'profile_image' | 'channel_image'; id: string; field: 'avatarUrl' | 'coverUrl' },
): Promise<CsamResolution | null> {
	if (input.kind === 'video') {
		const v = await json<VideoRow>(env.videos, input.videoId);
		return v ? { kind: 'video', videoId: input.videoId, channelId: v.channelId ?? null, uploaderId: v.userId ?? null } : null;
	}
	if (input.kind === 'post') {
		const p = await json<{ userId?: string }>(env.community_posts, `posts/${input.channelId}/${input.postId}.json`);
		return p ? { kind: 'post_image', channelId: input.channelId, postId: input.postId, uploaderId: p.userId ?? null } : null;
	}
	if (input.kind === 'channel_image') {
		const ch = await json<Record<string, any>>(env.channels, input.id);
		const url = ch?.[input.field] ?? ch?.pendingImages?.[input.field]?.url;
		const path = typeof url === 'string' ? new URL(url).pathname : undefined;
		return ch ? { kind: 'channel_image', channelId: input.id, imageField: input.field, ...(path ? { imagePath: path } : {}), uploaderId: ch.userId ?? null } : null;
	}
	const profile = await json<Record<string, any>>(env.profiles, input.id);
	if (!profile) return null;
	const url = profile[input.field] ?? profile.pendingImages?.[input.field]?.url;
	const path = typeof url === 'string' ? new URL(url).pathname : undefined;
	return { kind: 'profile_image', imageField: input.field, ...(path ? { imagePath: path } : {}), channelId: null, uploaderId: input.id };
}
