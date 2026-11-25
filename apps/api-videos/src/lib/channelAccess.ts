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
	OWNERSHIP_TABLE,
	type SearchDb,
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

/**
 * The caller's role on a record of a channel (video, playlist, stream): their role on its live
 * channel. A record's own `userId` decides only where there is no channel (a personal playlist, a
 * video without one, a channel that is gone): a channel can move to another account, and what is on
 * it moves at once, whichever records still name the previous owner. Throws when the channel cannot
 * be read (callers refuse).
 */
export async function roleOnRecord(env: ChannelAccessEnv, record: { userId?: string | null; channelId?: string | null }, userId: string): Promise<ChannelRole | null> {
	if (record.channelId && env.channels) {
		const object = await env.channels.get(record.channelId);
		if (object) {
			const channel = (await object.json()) as AccessChannel | null;
			if (!channel || typeof channel !== 'object') throw new Error('Unreadable channel record');
			return channelRoleOf(channel, userId);
		}
	}
	return record.userId && record.userId === userId ? 'owner' : null;
}

/** Whether the caller owns the record now: its live channel's owner (see roleOnRecord). False when the channel cannot be read. */
export async function ownsRecord(env: ChannelAccessEnv, record: { userId?: string | null; channelId?: string | null }, userId: string | null | undefined): Promise<boolean> {
	if (!userId) return false;
	try {
		return (await roleOnRecord(env, record, userId)) === 'owner';
	} catch (error) {
		logger.warn('[ChannelAccess] Channel read failed; ownership refused', { channelId: record.channelId, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/**
 * One request's channel reads: each channel is read once, however many of its records a list checks.
 * Only for checks within one request; a write re-reads what it depends on.
 */
export function memoChannels(env: ChannelAccessEnv): ChannelAccessEnv {
	const bucket = env.channels;
	if (!bucket) return {};
	const reads = new Map<string, Promise<{ json(): Promise<unknown> } | null>>();
	const get = (id: string) => {
		let read = reads.get(id);
		if (!read) {
			read = (async () => {
				const object = await bucket.get(id);
				if (!object) return null;
				const value = await object.json();
				return { json: async () => value };
			})();
			reads.set(id, read);
		}
		return read;
	};
	return { channels: { get } as unknown as R2Bucket };
}

/** Channels the ownership index gives to the user (a list's candidates: the live record decides). Null when it cannot say. */
export async function ownedChannelIds(env: { SEARCH_DB?: unknown }, userId: string | null | undefined): Promise<Set<string> | null> {
	const db = env.SEARCH_DB as SearchDb | undefined;
	if (!db || !userId) return null;
	try {
		const { results } = await db.prepare(`SELECT id FROM ${OWNERSHIP_TABLE} WHERE kind = 'channel' AND owner_id = ?`).bind(userId).all<{ id: string }>();
		return new Set((results ?? []).map((r) => r.id));
	} catch {
		return null;
	}
}

/**
 * Whether `userId` may still speak as the channel a comment was written as: no channel (their own
 * name), or a role on the live channel that grants `channel.speak`. A channel that is gone or cannot
 * be read speaks for nobody.
 */
export async function maySpeakAs(env: ChannelAccessEnv, channelId: string | null | undefined, userId: string): Promise<boolean> {
	if (!channelId || channelId === userId) return true;
	try {
		return can(await roleOnChannel(env, channelId, userId), 'channel.speak');
	} catch (error) {
		logger.warn('[ChannelAccess] Channel read failed; refused', { channelId, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/**
 * Whether `userId` may delete a comment they wrote, by the channel it was written as: as maySpeakAs,
 * and their own words once that channel is gone and nobody else ever owned it (its owner deleted it).
 * A channel that moved to another account (its finished move, idx_admin_jobs_target) or cannot be
 * read refuses.
 */
export async function mayDeleteOwn(env: ChannelAccessEnv, channelId: string | null | undefined, userId: string): Promise<boolean> {
	if (!channelId || channelId === userId) return true;
	if (!env.channels) return false;
	try {
		if (await env.channels.head(channelId)) return maySpeakAs(env, channelId, userId);
		const db = env.SEARCH_DB as SearchDb | undefined;
		if (!db) return true;
		const moved = await db
			.prepare(`SELECT 1 AS n FROM admin_jobs WHERE target_kind = 'channel' AND target_id = ? AND kind = 'channel.transfer' AND status = 'succeeded' LIMIT 1`)
			.bind(channelId)
			.first();
		return !moved;
	} catch (error) {
		logger.warn('[ChannelAccess] Channel read failed; refused', { channelId, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/** The fields of a video record a content check reads. */
export interface AccessVideo {
	userId?: string | null;
	channelId?: string | null;
	uploadedBy?: string | null;
}

/**
 * Whether `userId` may do `capability` on a video. The owner of its channel
 * now (or the uploader of a video without a channel) may do everything.
 * Anyone else needs a role on the channel that grants it; an editor deletes
 * only their own uploads.
 */
export async function canOnVideo(env: ChannelAccessEnv, video: AccessVideo, userId: string | null | undefined, capability: ChannelCapability): Promise<boolean> {
	if (!userId) return false;
	let role: ChannelRole | null;
	try {
		role = await roleOnRecord(env, video, userId);
	} catch (error) {
		// Fail closed: no role is granted when the channel cannot be read
		logger.warn('[ChannelAccess] Channel read failed; access refused', { channelId: video.channelId, capability, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
	if (role === 'owner') return true;
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
 * Whether `userId` may change a playlist (add or remove videos), and see it
 * while private: a channel's playlist needs a role on that channel now that
 * grants `playlist.manage` (owner, admin, editor); a personal or system one is
 * its owner's alone. Fails closed when the channel cannot be read.
 */
export async function canManagePlaylist(env: ChannelAccessEnv, playlist: AccessPlaylist, userId: string | null | undefined): Promise<boolean> {
	if (!userId) return false;
	// A system playlist (Watch later) is personal: only its owner
	if (isSystemPlaylist(playlist)) return !!playlist.userId && playlist.userId === userId;
	try {
		return can(await roleOnRecord(env, playlist, userId), 'playlist.manage');
	} catch (error) {
		logger.warn('[ChannelAccess] Channel read failed; playlist access refused', { channelId: playlist.channelId, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/** The fields of a live stream record a manage check reads. */
export interface AccessLiveStream {
	userId?: string | null;
	channelId?: string | null;
}

/**
 * Whether `userId` may manage a live stream (edit, see its stream key, start,
 * end, delete, see it while private): `live.manage` on the stream's channel
 * now; a stream without a channel is its creator's. Fails closed when the
 * channel cannot be read.
 */
export async function canManageLiveStream(env: ChannelAccessEnv, stream: AccessLiveStream, userId: string | null | undefined): Promise<boolean> {
	if (!userId) return false;
	try {
		return can(await roleOnRecord(env, stream, userId), 'live.manage');
	} catch (error) {
		logger.warn('[ChannelAccess] Channel read failed; live stream access refused', { channelId: stream.channelId, error: error instanceof Error ? error.message : String(error) });
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
	{ methods: ['PUT', 'DELETE'], path: /^\/api\/channels\/[^/]+\/members\/[^/]+\/?$/, capability: 'channel.speak' },
	{ methods: ['POST', 'DELETE'], path: /^\/api\/channels\/[^/]+\/invites(?:\/[^/]+)?\/?$/, capability: 'channel.speak' },
	// My own invitations: accepting or declining while another channel is active
	{ methods: ['POST'], path: /^\/api\/channel-invites\/[^/]+\/(?:accept|decline)\/?$/, capability: 'channel.speak' },
	// Comment moderation (Studio Comments, #771): video and post comments, the channel's comment list and blocks
	{ methods: ['POST'], path: /^\/api\/videos\/[^/]+\/comments\/[^/]+\/(?:approve|restore|hold|pin|heart)\/?$/, capability: 'comment.moderate' },
	{ methods: ['POST', 'DELETE'], path: /^\/api\/community\/channels\/[^/]+\/posts\/[^/]+\/comments\/[^/]+\/(?:pin|heart)\/?$/, capability: 'comment.moderate' },
	{ methods: ['POST'], path: /^\/api\/community\/channels\/[^/]+\/posts\/[^/]+\/comments\/[^/]+\/(?:approve|hold|restore)\/?$/, capability: 'comment.moderate' },
	{ methods: ['POST'], path: /^\/api\/channels\/[^/]+\/comments\/bulk\/?$/, capability: 'comment.moderate' },
	{ methods: ['POST', 'DELETE'], path: /^\/api\/channels\/[^/]+\/blocks(?:\/[^/]+)?\/?$/, capability: 'comment.moderate' },
	// Post comments as the channel: replies (channel.speak), edits and deletes (the endpoints decide)
	{ methods: ['POST'], path: /^\/api\/community\/channels\/[^/]+\/posts\/[^/]+\/comments\/?$/, capability: 'channel.speak' },
	{ methods: ['PUT', 'DELETE'], path: /^\/api\/community\/channels\/[^/]+\/posts\/[^/]+\/comments\/[^/]+\/?$/, capability: 'channel.speak' },
	// The channel's community posts: create, edit, delete, and their media (post.manage)
	{ methods: ['POST'], path: /^\/api\/community\/channels\/[^/]+\/posts\/?$/, capability: 'post.manage' },
	{ methods: ['PUT', 'DELETE'], path: /^\/api\/community\/channels\/[^/]+\/posts\/[^/]+\/?$/, capability: 'post.manage' },
	{ methods: ['POST'], path: /^\/api\/community\/media\/(?:upload\/images|upload\/gif|link-preview)\/?$/, capability: 'post.manage' },
	// Uploads
	{ methods: ['POST'], path: /^\/api\/videos\/?$/, capability: 'video.upload' },
	{ methods: ['POST', 'PATCH', 'HEAD', 'DELETE'], path: /^\/api\/videos\/(?:upload|tus)(?:\/|$)/, capability: 'video.upload' },
	// Move from YouTube (wiki AUN-YT-IMPORT): importing is uploading
	{ methods: ['POST', 'PUT'], path: /^\/api\/youtube-import(?:\/|$)/, capability: 'video.upload' },
	// Editing the channel's videos
	{ methods: ['PUT'], path: /^\/api\/videos\/(?!bulk-|upload|tus|scheduled|search)[^/]+\/?$/, capability: 'video.edit' },
	{ methods: ['POST'], path: /^\/api\/videos\/[^/]+\/thumbnail\/?$/, capability: 'video.edit' },
	{ methods: ['PUT'], path: /^\/api\/videos\/[^/]+\/chapters\/?$/, capability: 'video.edit' },
	{ methods: ['POST', 'PUT', 'DELETE'], path: /^\/api\/videos\/[^/]+\/subtitles(?:\/|$)/, capability: 'video.edit' },
	// Caption drafts, transcription jobs and on-device transcripts (the handlers check video.edit on the video too)
	{ methods: ['POST', 'PUT', 'DELETE'], path: /^\/api\/videos\/[^/]+\/captions(?:\/|$)/, capability: 'video.edit' },
	// Renditions pre-encoded in desktop Studio belong to the upload (D11)
	{ methods: ['POST', 'PUT', 'DELETE'], path: /^\/api\/videos\/[^/]+\/renditions(?:\/|$)/, capability: 'video.upload' },
	{ methods: ['POST', 'PATCH', 'DELETE'], path: /^\/api\/videos\/[^/]+\/(?:schedule|publish-now|premiere)\/?$/, capability: 'video.schedule' },
	{ methods: ['DELETE'], path: /^\/api\/videos\/(?!bulk-|upload|tus)[^/]+\/?$/, capability: 'video.delete' },
	// Restoring a deleted video (bulk-restore and DELETE …/permanent stay owner only)
	{ methods: ['POST'], path: /^\/api\/videos\/(?!bulk-|upload|tus)[^/]+\/restore\/?$/, capability: 'video.delete' },
	// Editing the channel itself
	{ methods: ['PUT'], path: /^\/api\/channels\/(?!handles|by-handle|access)[^/]+\/?$/, capability: 'channel.edit' },
	{ methods: ['PUT'], path: /^\/api\/channels\/[^/]+\/(?:avatar|cover|tabs)\/?$/, capability: 'channel.edit' },
	{ methods: ['POST', 'PUT', 'PATCH', 'DELETE'], path: /^\/api\/channels\/[^/]+\/sections(?:\/|$)/, capability: 'channel.edit' },
	// Community posts: write, edit, delete, their images and GIFs
	{ methods: ['POST'], path: /^\/api\/community\/channels\/[^/]+\/posts\/?$/, capability: 'post.manage' },
	{ methods: ['PUT', 'DELETE'], path: /^\/api\/community\/channels\/[^/]+\/posts\/[^/]+\/?$/, capability: 'post.manage' },
	{ methods: ['POST'], path: /^\/api\/community\/media\/(?:upload\/images|upload\/gif|link-preview)\/?$/, capability: 'post.manage' },
	// Acting as the channel on posts: likes, votes, comments (removing someone
	// else's comment is checked for comment.moderate in the endpoint)
	{ methods: ['POST', 'DELETE'], path: /^\/api\/community\/channels\/[^/]+\/posts\/[^/]+\/(?:like|vote)\/?$/, capability: 'channel.speak' },
	{ methods: ['POST'], path: /^\/api\/community\/channels\/[^/]+\/posts\/[^/]+\/comments\/?$/, capability: 'channel.speak' },
	{ methods: ['PUT', 'DELETE'], path: /^\/api\/community\/channels\/[^/]+\/posts\/[^/]+\/comments\/[^/]+\/?$/, capability: 'channel.speak' },
	{ methods: ['POST', 'DELETE'], path: /^\/api\/community\/channels\/[^/]+\/posts\/[^/]+\/comments\/[^/]+\/like\/?$/, capability: 'channel.speak' },
	// Post comment moderation
	{ methods: ['POST', 'DELETE'], path: /^\/api\/community\/channels\/[^/]+\/posts\/[^/]+\/comments\/[^/]+\/(?:pin|heart)\/?$/, capability: 'comment.moderate' },
	// Live streams: create, edit, delete, start, end (the stream key is a GET on /ingest)
	{ methods: ['POST'], path: /^\/api\/live-streams\/?$/, capability: 'live.manage' },
	{ methods: ['PATCH', 'DELETE'], path: /^\/api\/live-streams\/[^/]+\/?$/, capability: 'live.manage' },
	{ methods: ['POST'], path: /^\/api\/live-streams\/[^/]+\/(?:start|end)\/?$/, capability: 'live.manage' },
	// The member's own reminder, whichever channel is active
	{ methods: ['POST', 'DELETE'], path: /^\/api\/live-streams\/[^/]+\/reminders\/?$/, capability: 'channel.speak' },
	{ methods: ['PATCH'], path: /^\/api\/live-streams\/[^/]+\/premiere\/?$/, capability: 'live.manage' },
	// Live chat (wiki E17): posting as the channel, moderating, its settings (the endpoints decide)
	{ methods: ['POST'], path: /^\/api\/live-streams\/[^/]+\/chat\/?$/, capability: 'channel.speak' },
	{ methods: ['POST'], path: /^\/api\/live-streams\/[^/]+\/chat\/[^/]+\/moderate\/?$/, capability: 'channel.speak' },
	{ methods: ['PATCH'], path: /^\/api\/live-streams\/[^/]+\/chat\/settings\/?$/, capability: 'live.moderate' },
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
