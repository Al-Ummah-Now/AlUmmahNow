/**
 * Per-channel role checks (docs/specs/CHANNEL-ROLES.md).
 *
 * The role comes from the R2 channel record alone: `channel.userId` is the
 * owner and `channel.members` holds everyone else, so a check costs no read
 * beyond the channel the route loads anyway. Channel roles are not site
 * roles: nothing here reads token roles, and a site admin holds no channel
 * role.
 */

import {
	can,
	canDeleteVideo,
	channelRoleOf,
	type ChannelCapability,
	type ChannelRole,
	type ChannelRoleSource,
} from '@al-ummah/shared-types';
import { logger } from './logger';
import { isSystemPlaylist } from './library';

export interface ChannelAccessEnv {
	channels?: R2Bucket;
	[binding: string]: unknown;
}

export type AccessChannel = ChannelRoleSource & { id?: string; isDeleted?: boolean | null; isSuspended?: boolean | null };

/** Read a channel record; null when it is missing or unreadable. */
export async function loadChannelRecord(env: ChannelAccessEnv, channelId: string): Promise<AccessChannel | null> {
	if (!channelId || !env.channels) return null;
	const object = await env.channels.get(channelId);
	if (!object) return null;
	return (await object.json()) as AccessChannel;
}

/** The caller's role on a channel (null: none, or the channel is missing). */
export async function roleOnChannel(env: ChannelAccessEnv, channelId: string, userId: string): Promise<ChannelRole | null> {
	return channelRoleOf(await loadChannelRecord(env, channelId), userId);
}

/** The fields of a video record a content check reads. */
export interface AccessVideo {
	userId?: string | null;
	channelId?: string | null;
	uploadedBy?: string | null;
}

/**
 * Whether `userId` may do `capability` on a video. The video's owner (its
 * channel's owner, or the uploader of a legacy video without a channel) may
 * do everything, as before. Anyone else needs a role on the video's channel
 * that grants it; an editor deletes only their own uploads.
 */
export async function canOnVideo(env: ChannelAccessEnv, video: AccessVideo, userId: string | null | undefined, capability: ChannelCapability): Promise<boolean> {
	if (!userId) return false;
	if (video.userId && video.userId === userId) return true;
	if (!video.channelId) return false;
	let role: ChannelRole | null;
	try {
		role = await roleOnChannel(env, video.channelId, userId);
	} catch (error) {
		// Fail closed: no role is granted when the channel cannot be read
		logger.warn('[ChannelAccess] Channel read failed; access refused', { channelId: video.channelId, capability, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
	if (capability === 'video.delete') return canDeleteVideo(role, video, userId);
	return can(role, capability);
}

/** The fields of a playlist record a manage check reads. */
export interface AccessPlaylist {
	id?: string;
	userId?: string | null;
	channelId?: string | null;
	systemType?: unknown;
}

/**
 * Whether `userId` may change a playlist (add or remove videos). Its owner
 * may, as before; anyone else needs a role on the playlist's channel that
 * grants `playlist.manage` (owner, admin, editor), except on a system
 * playlist. Fails closed when the channel cannot be read.
 */
export async function canManagePlaylist(env: ChannelAccessEnv, playlist: AccessPlaylist, userId: string | null | undefined): Promise<boolean> {
	if (!userId) return false;
	if (playlist.userId && playlist.userId === userId) return true;
	// A system playlist (Watch later) is personal: only its owner
	if (!playlist.channelId || isSystemPlaylist(playlist)) return false;
	try {
		return can(await roleOnChannel(env, playlist.channelId, userId), 'playlist.manage');
	} catch (error) {
		logger.warn('[ChannelAccess] Channel read failed; playlist access refused', { channelId: playlist.channelId, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/**
 * Who owns a video created as `channelId`: the channel's owner, whoever
 * uploads it (spec §8). `video.userId` keeps meaning "the channel owner", so
 * the ownership index, plan limits, erasure and transfers stay correct, and
 * `uploadedBy` records the member. Set by channelIdMiddleware.
 */
export function uploadIdentity(c: { get: (key: string) => unknown }, userId: string): { ownerId: string; uploadedBy?: string } {
	const ownerId = c.get('channelOwnerId');
	if (typeof ownerId === 'string' && ownerId && ownerId !== userId) return { ownerId, uploadedBy: userId };
	return { ownerId: userId };
}

/**
 * Writes a channel member (not the owner) may make while acting as the
 * channel through the `channelId` header, and the capability each needs.
 * Reads pass for any member. Any write not listed stays owner only (spec
 * §6.3), so a route that was missed fails closed. Routes listed here still
 * run their own check on the record they change.
 */
const MEMBER_WRITE_ROUTES: ReadonlyArray<{ methods: ReadonlyArray<string>; path: RegExp; capability: ChannelCapability }> = [
	// Acting as the channel: reactions, comments, views, subscriptions, the member's own lists
	{ methods: ['POST', 'DELETE'], path: /^\/api\/videos\/[^/]+\/(?:comments\/[^/]+\/)?(?:likes|dislikes)\/?$/, capability: 'channel.speak' },
	{ methods: ['POST'], path: /^\/api\/videos\/[^/]+\/comments\/?$/, capability: 'channel.speak' },
	{ methods: ['PUT', 'DELETE'], path: /^\/api\/videos\/[^/]+\/comments\/[^/]+\/?$/, capability: 'channel.speak' },
	{ methods: ['POST'], path: /^\/api\/videos\/[^/]+\/(?:view|watch-time)\/?$/, capability: 'channel.speak' },
	{ methods: ['POST', 'DELETE'], path: /^\/api\/channels\/[^/]+\/subscriptions\/?$/, capability: 'channel.speak' },
	{ methods: ['POST', 'PUT', 'PATCH', 'DELETE'], path: /^\/api\/(?:watch-history|library|watch-state|continue-watching)(?:\/|$)/, capability: 'channel.speak' },
	{ methods: ['POST'], path: /^\/api\/moderation\/reports\/?$/, capability: 'channel.speak' },
	// Members API: the endpoints decide who may change what
	{ methods: ['POST', 'PUT', 'DELETE'], path: /^\/api\/channels\/[^/]+\/members(?:\/[^/]+)?\/?$/, capability: 'channel.speak' },
	// Comment moderation
	{ methods: ['POST'], path: /^\/api\/videos\/[^/]+\/comments\/[^/]+\/approve\/?$/, capability: 'comment.moderate' },
	// Uploads
	{ methods: ['POST'], path: /^\/api\/videos\/?$/, capability: 'video.upload' },
	{ methods: ['POST', 'PATCH', 'HEAD', 'DELETE'], path: /^\/api\/videos\/(?:upload|tus)(?:\/|$)/, capability: 'video.upload' },
	// Editing the channel's videos
	{ methods: ['PUT'], path: /^\/api\/videos\/(?!bulk-|upload|tus|scheduled|search)[^/]+\/?$/, capability: 'video.edit' },
	{ methods: ['POST'], path: /^\/api\/videos\/[^/]+\/thumbnail\/?$/, capability: 'video.edit' },
	{ methods: ['PUT'], path: /^\/api\/videos\/[^/]+\/chapters\/?$/, capability: 'video.edit' },
	{ methods: ['POST', 'PUT', 'DELETE'], path: /^\/api\/videos\/[^/]+\/subtitles(?:\/|$)/, capability: 'video.edit' },
	{ methods: ['POST', 'PATCH', 'DELETE'], path: /^\/api\/videos\/[^/]+\/(?:schedule|publish-now)\/?$/, capability: 'video.schedule' },
	{ methods: ['DELETE'], path: /^\/api\/videos\/(?!bulk-|upload|tus)[^/]+\/?$/, capability: 'video.delete' },
	// Editing the channel itself
	{ methods: ['PUT'], path: /^\/api\/channels\/(?!handles|by-handle|access)[^/]+\/?$/, capability: 'channel.edit' },
	{ methods: ['PUT'], path: /^\/api\/channels\/[^/]+\/(?:avatar|cover|tabs)\/?$/, capability: 'channel.edit' },
	{ methods: ['POST', 'PUT', 'PATCH', 'DELETE'], path: /^\/api\/channels\/[^/]+\/sections(?:\/|$)/, capability: 'channel.edit' },
	// The channel's playlists: create, edit, delete, add, remove and reorder videos,
	// queue adds for new uploads
	{ methods: ['POST', 'PUT', 'PATCH', 'DELETE'], path: /^\/api\/playlists(?:\/|$)/, capability: 'playlist.manage' },
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Whether a member holding `role` may send this request as the channel.
 * Owners never reach this (they pass as before).
 */
export function memberMayActAs(role: ChannelRole | null, method: string, path: string): boolean {
	if (!role || role === 'owner') return role === 'owner';
	const m = method.toUpperCase();
	// A listed route decides (TUS HEAD resume probes count as uploads)
	const route = MEMBER_WRITE_ROUTES.find(r => r.methods.includes(m) && r.path.test(path));
	if (route) return can(role, route.capability);
	return SAFE_METHODS.has(m);
}
