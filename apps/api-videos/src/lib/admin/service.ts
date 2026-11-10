/**
 * Admin actions on platform content, called by admin-api through
 * /internal/admin/* (admin-api checks the admin's permissions and writes the
 * audit log; this module owns the data rules).
 *
 * Every write is a conditional write on the fresh object (R2Repository), and
 * goes through the env's wrapped buckets, so the search, ownership and
 * comment indexes follow (lib/search/sync.ts).
 */
import {
	applySuspensionHold,
	channelHold,
	isHeldBy,
	liftSuspensionHold,
	userHold,
	type AdminCascadeResult,
	type AdminChannelDetail,
	type AdminUserDetail,
	type AdminVideoDetail,
	type SuspendableRecord,
	type SuspensionInfo,
	type VideosBan,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import Queue, { MessageType } from '../queue';
import { claimHandle, handleKey, normalizeHandleInput, releaseHandle, releaseReplacedHandle } from '../channelHandles';
import { pickNewMainChannel, removeChannelContent, type OwnedChannelSummary } from '../channelDeletion';
import { findStoredComment, removeStoredComment, type StoredComment } from '../comments';
import { subscriberCounts, subscribedChannelIds } from '../subscription-store';
import { eraseUserData } from '../privacy/user-data';
import { OperationBudget } from '../privacy/scan';
import { BunnyStreamClient } from '../bunny/stream';
import { requireSecret } from '../env-helpers';
import { bansFor, deleteBan, readBan, writeBan } from './bans';
import {
	channelVideoStats,
	contentIds,
	countPrefix,
	ensureAdminIndex,
	hydrateChannels,
	readMany,
	toUserRow,
	type AdminEnv,
} from './directory';

type Row = Record<string, any>;

export interface AdminServiceEnv extends AdminEnv {
	queue?: Queue | { send(message: unknown): Promise<void> };
	channel_tabs?: R2Bucket;
	channel_sections?: R2Bucket;
	'bunny-stream-key'?: { text(): Promise<string> } | string;
	bunny_stream_library_id?: { text(): Promise<string> } | string;
}

export class AdminError extends Error {
	constructor(public status: 400 | 403 | 404 | 409, public code: string, message?: string) {
		super(message ?? code);
	}
}

const now = () => new Date().toISOString();
const repo = <T = Row>(bucket: R2Bucket) => new R2Repository<T>(bucket);

async function send(env: AdminServiceEnv, type: MessageType, payload: Record<string, unknown>): Promise<void> {
	try {
		await new Queue(env.queue as never).send(type, { ...payload, timestamp: now(), source: 'admin' });
	} catch (error) {
		logger.warn('[Admin] Queue send failed', { type, error: error instanceof Error ? error.message : String(error) });
	}
}

async function bunny(env: AdminServiceEnv): Promise<{ client: BunnyStreamClient; libraryId: number } | null> {
	try {
		const key = await requireSecret(env['bunny-stream-key'] as never, 'bunny-stream-key');
		const libraryId = parseInt(await requireSecret(env.bunny_stream_library_id as never, 'bunny_stream_library_id'), 10);
		return { client: new BunnyStreamClient(key), libraryId };
	} catch (error) {
		logger.warn('[Admin] Bunny Stream unavailable', { error: error instanceof Error ? error.message : String(error) });
		return null;
	}
}

/** Runs `task` over `items`, `limit` at a time. */
async function eachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) await task(items[next++]);
		}),
	);
}

/**
 * Ids of a channel's or a user's videos (and a user's channels). The ownership
 * index answers once complete; otherwise the bucket is scanned.
 */
async function idsOf(env: AdminServiceEnv, kind: 'video' | 'channel', by: { channelId?: string; ownerId?: string }): Promise<string[]> {
	if (env.SEARCH_DB && (await ensureAdminIndex(env, kind))) return contentIds(env.SEARCH_DB, kind, by);
	const bucket = kind === 'video' ? env.videos : env.channels;
	const ids: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ limit: 100, cursor });
		const objects = await readMany(bucket, page.objects.map((o) => o.key).filter((k) => !k.includes(':') && !k.includes('/')));
		for (const [key, value] of objects) {
			if (value.isDeleted === true) continue;
			if (by.channelId ? value.channelId === by.channelId : value.userId === by.ownerId) ids.push(key);
		}
		cursor = page.truncated ? (page as { cursor?: string }).cursor : undefined;
	} while (cursor);
	return ids;
}

/** Live stream records scanned per cascade (they are few; this bounds one request). */
const LIVE_STREAM_SCAN_LIMIT = 2000;

/**
 * Keys of the live streams (`livestream:<id>` in the videos bucket) of a
 * channel or owner. They are not in the ownership index, so this is a prefix
 * scan; `truncated` is true when it stopped at the limit before the end, and
 * the caller reports the cascade as incomplete so the admin retries it.
 */
async function liveStreamKeysOf(env: AdminServiceEnv, by: { channelId?: string; ownerId?: string }): Promise<{ keys: string[]; truncated: boolean }> {
	const keys: string[] = [];
	let cursor: string | undefined;
	let scanned = 0;
	do {
		const page = await env.videos.list({ prefix: 'livestream:', limit: 100, cursor });
		scanned += page.objects.length;
		const objects = await readMany(env.videos, page.objects.map((o) => o.key));
		for (const [key, value] of objects) {
			if (by.channelId ? value.channelId === by.channelId : value.userId === by.ownerId) keys.push(key);
		}
		cursor = page.truncated ? (page as { cursor?: string }).cursor : undefined;
	} while (cursor && scanned < LIVE_STREAM_SCAN_LIMIT);
	if (cursor) logger.warn('[Admin] Live stream scan stopped at its limit; the cascade is incomplete', { ...by, scanned });
	return { keys, truncated: !!cursor };
}

/** Holds (or lifts) on the live streams of a channel or owner; an unfinished scan counts as a failure. */
async function cascadeLiveStreams(env: AdminServiceEnv, by: { channelId?: string; ownerId?: string }, mutate: (record: Row) => boolean): Promise<{ changed: number; failed: number }> {
	const { keys, truncated } = await liveStreamKeysOf(env, by);
	const result = await cascade(env.videos, keys, mutate);
	return { changed: result.changed, failed: result.failed + (truncated ? 1 : 0) };
}

/** Applies `mutate` to each record; counts the ones that changed and the ones that failed. */
async function cascade(bucket: R2Bucket, ids: string[], mutate: (record: Row) => boolean): Promise<{ changed: number; failed: number }> {
	let changed = 0;
	let failed = 0;
	await eachLimited(ids, 8, async (id) => {
		try {
			let did = false;
			await repo(bucket).updateObject(id, (record) => {
				did = mutate(record);
				if (did) record.dateModified = now();
				return did;
			});
			if (did) changed++;
		} catch (error) {
			failed++;
			logger.warn('[Admin] Cascade write failed', { id, error: error instanceof Error ? error.message : String(error) });
		}
	});
	return { changed, failed };
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export async function channelDetail(env: AdminServiceEnv, id: string): Promise<AdminChannelDetail> {
	const channel = await repo(env.channels).getObject(id);
	if (!channel) throw new AdminError(404, 'channel_not_found');
	const db = env.SEARCH_DB!;
	const [stats, counts, ownerProfile, bans] = await Promise.all([
		channelVideoStats(db, id),
		subscriberCounts(env.NOTIFICATIONS_DB, [channel as never]).catch(() => new Map<string, number>()),
		channel.userId ? repo(env.profiles).getObject(channel.userId) : Promise.resolve(null),
		bansFor(db, channel.userId ? [channel.userId] : []),
	]);
	const [row] = await hydrateChannels(env, [
		{
			id,
			owner_id: channel.userId ?? null,
			title: channel.name,
			handle: channel.handle,
			email: channel.email,
			is_verified: channel.isVerified ? 1 : 0,
			is_suspended: channel.isSuspended ? 1 : 0,
			is_public: channel.isPrivate ? 0 : 1,
			is_deleted: channel.isDeleted ? 1 : 0,
			total_views: stats.views,
			created_at: Date.parse(channel.dateCreated) || null,
		},
	]);
	return {
		...row,
		description: channel.description ?? '',
		coverUrl: channel.coverUrl ?? null,
		isMain: channel.isMain === true,
		suspension: (channel.suspension as SuspensionInfo | undefined) ?? null,
		stats: {
			videos: stats.videos,
			subscribers: counts.get(id) ?? 0,
			views: stats.views,
			playlists: Array.isArray(channel.playlists) ? channel.playlists.length : 0,
		},
		owner: channel.userId ? toUserRow(channel.userId, ownerProfile, bans.has(channel.userId)) : null,
	};
}

export interface ChannelEdit {
	name?: string;
	handle?: string;
	description?: string;
	avatarUrl?: string | null;
	coverUrl?: string | null;
}

export async function updateChannel(env: AdminServiceEnv, id: string, edit: ChannelEdit): Promise<Row> {
	const channels = repo(env.channels);
	const existing = await channels.getObject(id);
	if (!existing || existing.isDeleted) throw new AdminError(404, 'channel_not_found');
	let claimed: string | null = null;
	if (edit.handle !== undefined && normalizeHandleInput(edit.handle) !== (existing.handle || '')) {
		if (!env.channel_tabs) throw new AdminError(400, 'handles_unavailable');
		// Admins may give official (reserved) handles, like super admins in the app
		const claim = await claimHandle(env.channel_tabs, edit.handle, existing, { allowOfficial: true });
		if (claim.ok === false) throw new AdminError(409, 'handle_unavailable', claim.reason);
		claimed = claim.handle;
	}
	let previousHandle: string | undefined;
	const saved = await channels.updateObject(id, (fresh) => {
		previousHandle = fresh.handle;
		if (edit.name !== undefined) fresh.name = edit.name;
		if (edit.description !== undefined) fresh.description = edit.description;
		if (edit.avatarUrl !== undefined) fresh.avatarUrl = edit.avatarUrl ?? undefined;
		if (edit.coverUrl !== undefined) fresh.coverUrl = edit.coverUrl ?? undefined;
		if (claimed) fresh.handle = claimed;
		fresh.dateModified = now();
	});
	if (!saved) throw new AdminError(404, 'channel_not_found');
	if (claimed && previousHandle && env.channel_tabs && handleKey(previousHandle) !== handleKey(claimed)) {
		await releaseReplacedHandle(env.channel_tabs, env.channels, previousHandle, id);
	}
	await send(env, MessageType.ChannelUpdate, { channelId: id, userId: saved.userId });
	return saved;
}

/** Suspends a channel: hidden everywhere with its videos; the owner still sees it with a notice. */
export async function suspendChannel(env: AdminServiceEnv, id: string, actorId: string, reason?: string): Promise<AdminCascadeResult> {
	const hold = channelHold(id);
	const info: SuspensionInfo = { at: now(), by: actorId, ...(reason ? { reason } : {}) };
	const saved = await repo(env.channels).updateObject(id, (fresh) => {
		if (fresh.isDeleted) return false;
		fresh.isSuspended = true;
		fresh.suspension = info;
		applySuspensionHold(fresh as SuspendableRecord, hold);
		fresh.dateModified = now();
		return true;
	});
	if (!saved || saved.isDeleted) throw new AdminError(404, 'channel_not_found');
	const videos = await cascade(env.videos, await idsOf(env, 'video', { channelId: id }), (v) => applySuspensionHold(v as SuspendableRecord, hold));
	const live = await cascadeLiveStreams(env, { channelId: id }, (s) => applySuspensionHold(s as SuspendableRecord, hold));
	videos.failed += live.failed;
	await send(env, MessageType.ChannelUpdate, { channelId: id, userId: saved.userId, action: 'suspended' });
	return { channels: 1, videos: videos.changed, failed: videos.failed, complete: videos.failed === 0 };
}

export async function unsuspendChannel(env: AdminServiceEnv, id: string): Promise<AdminCascadeResult> {
	const hold = channelHold(id);
	const saved = await repo(env.channels).updateObject(id, (fresh) => {
		fresh.isSuspended = false;
		delete fresh.suspension;
		liftSuspensionHold(fresh as SuspendableRecord, hold);
		fresh.dateModified = now();
	});
	if (!saved) throw new AdminError(404, 'channel_not_found');
	const videos = await cascade(env.videos, await idsOf(env, 'video', { channelId: id }), (v) => liftSuspensionHold(v as SuspendableRecord, hold));
	const live = await cascadeLiveStreams(env, { channelId: id }, (s) => liftSuspensionHold(s as SuspendableRecord, hold));
	videos.failed += live.failed;
	await send(env, MessageType.ChannelUpdate, { channelId: id, userId: saved.userId, action: 'unsuspended' });
	return { channels: 1, videos: videos.changed, failed: videos.failed, complete: videos.failed === 0 };
}

async function removeFromProfile(env: AdminServiceEnv, userId: string, channelId: string): Promise<void> {
	await repo(env.profiles).updateObject(userId, (profile) => {
		if (!Array.isArray(profile.channels) || !profile.channels.includes(channelId)) return false;
		profile.channels = profile.channels.filter((c: string) => c !== channelId);
		return true;
	});
}

/** Gives the old owner a new main channel when the one leaving was main. */
async function promoteNextMain(env: AdminServiceEnv, userId: string, leavingId: string): Promise<string | null> {
	const ids = (await idsOf(env, 'channel', { ownerId: userId })).filter((c) => c !== leavingId);
	const owned = [...(await readMany(env.channels, ids)).values()] as unknown as OwnedChannelSummary[];
	const next = pickNewMainChannel(owned, leavingId);
	if (!next) return null;
	await repo(env.channels).updateObject(next.id, (ch) => {
		ch.isMain = true;
		ch.dateModified = now();
	});
	return next.id;
}

/**
 * Moves a channel and its videos and playlists to another videos user. The new
 * owner must have a videos profile and must not be banned. Per-channel roles
 * live with the channel and move with it.
 */
export async function transferChannel(env: AdminServiceEnv, id: string, newOwnerId: string): Promise<AdminCascadeResult & { previousOwnerId: string | null }> {
	const channel = await repo(env.channels).getObject(id);
	if (!channel || channel.isDeleted) throw new AdminError(404, 'channel_not_found');
	if (channel.userId === newOwnerId) throw new AdminError(409, 'already_owner');
	const target = await repo(env.profiles).getObject(newOwnerId);
	if (!target) throw new AdminError(404, 'new_owner_not_found');
	if (env.SEARCH_DB && (await readBan(env.SEARCH_DB, newOwnerId))) throw new AdminError(409, 'new_owner_banned');
	const previousOwnerId: string | null = channel.userId ?? null;
	const targetHasChannels = (await idsOf(env, 'channel', { ownerId: newOwnerId })).length > 0;
	const saved = await repo(env.channels).updateObject(id, (fresh) => {
		fresh.userId = newOwnerId;
		fresh.isMain = !targetHasChannels;
		fresh.dateModified = now();
	});
	if (!saved) throw new AdminError(404, 'channel_not_found');
	await repo(env.profiles).updateObject(newOwnerId, (profile) => {
		const list: string[] = Array.isArray(profile.channels) ? profile.channels : [];
		if (list.includes(id)) return false;
		profile.channels = [...list, id];
		return true;
	});
	if (previousOwnerId) {
		await removeFromProfile(env, previousOwnerId, id);
		if (channel.isMain) await promoteNextMain(env, previousOwnerId, id);
	}
	const videos = await cascade(env.videos, await idsOf(env, 'video', { channelId: id }), (v) => {
		if (v.userId === newOwnerId) return false;
		v.userId = newOwnerId;
		return true;
	});
	const playlistIds = Array.isArray(channel.playlists) ? (channel.playlists as string[]).filter((p) => typeof p === 'string') : [];
	const playlists = await cascade(env.playlists, playlistIds, (p) => {
		if (p.channelId !== id || p.userId === newOwnerId) return false;
		p.userId = newOwnerId;
		return true;
	});
	await send(env, MessageType.ChannelUpdate, { channelId: id, userId: newOwnerId, previousOwnerId, action: 'transferred' });
	const failed = videos.failed + playlists.failed;
	return { channels: 1, videos: videos.changed, failed, complete: failed === 0, previousOwnerId };
}

/** Deletes a video's stored data, media and per-video records (the privacy-erase path). */
async function purgeVideo(env: AdminServiceEnv, videoId: string, video: Row | null, bunnyClient?: { client: BunnyStreamClient; libraryId: number } | null): Promise<void> {
	await env.videos.delete(videoId);
	const b = bunnyClient === undefined ? await bunny(env) : bunnyClient;
	if (b) {
		try {
			await b.client.deleteVideo(b.libraryId, videoId);
		} catch (error) {
			// The R2 record is gone, so the stream is unreachable from the app
			logger.warn('[Admin] Bunny Stream delete failed', { videoId, error: error instanceof Error ? error.message : String(error) });
		}
	}
	if (env.NOTIFICATIONS_DB) {
		try {
			await env.NOTIFICATIONS_DB.batch([
				env.NOTIFICATIONS_DB.prepare('DELETE FROM notifications WHERE entity_id = ?').bind(videoId),
				env.NOTIFICATIONS_DB.prepare('DELETE FROM liked_videos WHERE video_id = ?').bind(videoId),
			]);
		} catch (error) {
			logger.warn('[Admin] Notification cleanup failed', { videoId, error: error instanceof Error ? error.message : String(error) });
		}
	}
	await send(env, MessageType.VideoDelete, { videoId, userId: video?.userId, channelId: video?.channelId, reason: 'admin' });
}

/**
 * Soft-deletes a channel: the record stays (isDeleted, hidden, handle freed)
 * for the audit trail; its videos are erased (R2, Bunny, search, notifications),
 * its playlists, posts and sections removed.
 */
export async function deleteChannel(env: AdminServiceEnv, id: string, actorId: string): Promise<AdminCascadeResult> {
	const channel = await repo(env.channels).getObject(id);
	if (!channel || channel.isDeleted) throw new AdminError(404, 'channel_not_found');
	const at = now();
	await repo(env.channels).updateObject(id, (fresh) => {
		fresh.isDeleted = true;
		fresh.deletedAt = at;
		fresh.deletedBy = actorId;
		fresh.isHidden = true;
		fresh.isMain = false;
		fresh.dateModified = at;
	});
	if (env.channel_tabs) {
		try {
			await releaseHandle(env.channel_tabs, channel.handle, id);
			await env.channel_tabs.delete(`channel-tabs/${id}`);
		} catch (error) {
			logger.warn('[Admin] Could not release handle/tabs', { channelId: id, error: error instanceof Error ? error.message : String(error) });
		}
	}
	if (channel.userId) {
		await removeFromProfile(env, channel.userId, id);
		if (channel.isMain) await promoteNextMain(env, channel.userId, id);
	}
	const videoIds = await idsOf(env, 'video', { channelId: id });
	const b = await bunny(env);
	let failed = 0;
	await eachLimited(videoIds, 6, async (videoId) => {
		try {
			await purgeVideo(env, videoId, { userId: channel.userId, channelId: id }, b);
		} catch (error) {
			failed++;
			logger.warn('[Admin] Video purge failed', { videoId, error: error instanceof Error ? error.message : String(error) });
		}
	});
	// Playlists (soft), posts and sections, like an owner's delete
	await removeChannelContent({ videos: env.videos, playlists: env.playlists, community_posts: env.community_posts, channel_sections: env.channel_sections }, id);
	await send(env, MessageType.ChannelDelete, { channelId: id, userId: channel.userId, reason: 'admin' });
	return { channels: 1, videos: videoIds.length - failed, failed, complete: failed === 0 };
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

export async function videoDetail(env: AdminServiceEnv, id: string): Promise<AdminVideoDetail> {
	const video = await repo(env.videos).getObject(id);
	if (!video || id.includes(':')) throw new AdminError(404, 'video_not_found');
	const channel = video.channelId ? await repo(env.channels).getObject(video.channelId) : null;
	let processing: AdminVideoDetail['processing'] = null;
	const b = await bunny(env);
	if (b) {
		try {
			const model = (await b.client.getVideo(b.libraryId, id)) as Row;
			const STATUS = ['created', 'uploaded', 'processing', 'transcoding', 'finished', 'error', 'upload_failed', 'jit_segmenting', 'jit_playlists_created'];
			processing = {
				status: STATUS[Number(model.status)] ?? String(model.status ?? 'unknown'),
				encodeProgress: typeof model.encodeProgress === 'number' ? model.encodeProgress : null,
				resolutions: typeof model.availableResolutions === 'string' ? model.availableResolutions.split(',').filter(Boolean) : [],
			};
		} catch (error) {
			logger.debug('[Admin] Bunny status unavailable', { id, error: error instanceof Error ? error.message : String(error) });
		}
	}
	const countComments = (list: unknown): number =>
		Array.isArray(list) ? list.reduce((n: number, c: Row) => n + (c?.isDeleted ? 0 : 1) + countComments(c?.replies), 0) : 0;
	return {
		id,
		title: video.title ?? '',
		description: video.description ?? '',
		channelId: video.channelId ?? null,
		channelName: channel?.name ?? null,
		ownerId: video.userId ?? null,
		status: video.uploadStatus ?? null,
		isPublic: video.isPublic !== false,
		isHidden: video.isHidden === true,
		isDeleted: video.isDeleted === true,
		views: Number(video.views) || 0,
		duration: typeof video.duration === 'number' ? video.duration : null,
		thumbnailUrl: video.thumbnailUrl ?? null,
		createdAt: video.dateCreated ?? null,
		updatedAt: video.dateModified ?? null,
		playUrl: video.playUrl ?? null,
		videoUrl: video.videoUrl ?? null,
		availableResolutions: Array.isArray(video.availableResolutions) ? video.availableResolutions : [],
		width: video.width ?? null,
		height: video.height ?? null,
		fileSize: video.fileSize ?? null,
		category: video.category ?? null,
		language: video.language ?? null,
		tags: Array.isArray(video.tags) ? video.tags : [],
		commentCount: countComments(video.comments),
		likeCount: Array.isArray(video.likes) ? video.likes.length : 0,
		suspensionHolds: Array.isArray(video.suspensionHolds) ? video.suspensionHolds : [],
		moderationAction: video.moderationAction ?? null,
		processing,
	};
}

export interface VideoEdit {
	title?: string;
	description?: string;
	isPublic?: boolean;
	thumbnailUrl?: string;
}

export async function updateVideo(env: AdminServiceEnv, id: string, edit: VideoEdit): Promise<Row> {
	const saved = await repo(env.videos).updateObject(id, (fresh) => {
		if (edit.title !== undefined) {
			fresh.title = edit.title;
			if (fresh.titleLocalized && typeof fresh.titleLocalized === 'object') delete fresh.titleLocalized;
		}
		if (edit.description !== undefined) {
			fresh.description = edit.description;
			if (fresh.descriptionLocalized && typeof fresh.descriptionLocalized === 'object') delete fresh.descriptionLocalized;
		}
		if (edit.isPublic !== undefined) fresh.isPublic = edit.isPublic;
		if (edit.thumbnailUrl !== undefined) {
			fresh.thumbnailUrl = edit.thumbnailUrl;
			fresh.thumbnailType = 'custom';
			delete fresh.thumbnailSizes;
		}
		fresh.dateModified = now();
	});
	if (!saved) throw new AdminError(404, 'video_not_found');
	await send(env, MessageType.VideoEdit, { videoId: id, userId: saved.userId, channelId: saved.channelId });
	return saved;
}

/** Moves a video into another channel (and to that channel's owner); suspension holds follow the channel. */
export async function moveVideo(env: AdminServiceEnv, id: string, channelId: string): Promise<Row> {
	const target = await repo(env.channels).getObject(channelId);
	if (!target || target.isDeleted) throw new AdminError(404, 'channel_not_found');
	const saved = await repo(env.videos).updateObject(id, (fresh) => {
		if (fresh.channelId === channelId) return false;
		if (fresh.channelId) liftSuspensionHold(fresh as SuspendableRecord, channelHold(fresh.channelId));
		if (fresh.userId && fresh.userId !== target.userId) liftSuspensionHold(fresh as SuspendableRecord, userHold(fresh.userId));
		fresh.channelId = channelId;
		fresh.userId = target.userId;
		if (target.isSuspended) applySuspensionHold(fresh as SuspendableRecord, channelHold(channelId));
		if (isHeldBy(target as SuspendableRecord, userHold(target.userId))) applySuspensionHold(fresh as SuspendableRecord, userHold(target.userId));
		fresh.dateModified = now();
		return true;
	});
	if (!saved) throw new AdminError(404, 'video_not_found');
	if (saved.channelId !== channelId) throw new AdminError(409, 'move_failed');
	await send(env, MessageType.VideoEdit, { videoId: id, userId: saved.userId, channelId });
	return saved;
}

export const ADMIN_UNPUBLISH_HOLD = 'admin:unpublished';

/** Unpublish hides the video for everyone (the owner cannot undo it); republish lifts it. */
export async function setVideoPublished(env: AdminServiceEnv, id: string, published: boolean): Promise<Row> {
	const saved = await repo(env.videos).updateObject(id, (fresh) => {
		const changed = published
			? liftSuspensionHold(fresh as SuspendableRecord, ADMIN_UNPUBLISH_HOLD)
			: applySuspensionHold(fresh as SuspendableRecord, ADMIN_UNPUBLISH_HOLD);
		if (changed) fresh.dateModified = now();
		return changed;
	});
	if (!saved) throw new AdminError(404, 'video_not_found');
	await send(env, MessageType.VideoEdit, { videoId: id, userId: saved.userId, channelId: saved.channelId, action: published ? 'republished' : 'unpublished' });
	return saved;
}

/** Asks Bunny Stream to encode the video again from its original upload. */
export async function reprocessVideo(env: AdminServiceEnv, id: string): Promise<Row> {
	const video = await repo(env.videos).getObject(id);
	if (!video) throw new AdminError(404, 'video_not_found');
	const b = await bunny(env);
	if (!b) throw new AdminError(409, 'processor_unavailable');
	try {
		await b.client.reencodeVideo(b.libraryId, id);
	} catch (error) {
		logger.warn('[Admin] Reencode refused', { id, error: error instanceof Error ? error.message : String(error) });
		throw new AdminError(409, 'reprocess_refused', error instanceof Error ? error.message : String(error));
	}
	const saved = await repo(env.videos).updateObject(id, (fresh) => {
		fresh.uploadStatus = 'processing';
		fresh.dateModified = now();
	});
	return saved ?? video;
}

export async function deleteVideo(env: AdminServiceEnv, id: string): Promise<void> {
	const video = await repo(env.videos).getObject(id);
	if (!video || id.includes(':')) throw new AdminError(404, 'video_not_found');
	await purgeVideo(env, id, video);
}

// ---------------------------------------------------------------------------
// Comments, playlists, community posts
// ---------------------------------------------------------------------------

export async function deleteComment(env: AdminServiceEnv, videoId: string, commentId: string): Promise<void> {
	let found = false;
	const saved = await repo(env.videos).updateObject(videoId, (fresh) => {
		const target = findStoredComment(fresh.comments as StoredComment[], commentId);
		found = !!target;
		if (!target) return false;
		fresh.comments = removeStoredComment(fresh.comments as StoredComment[], commentId).comments;
		return true;
	});
	if (!saved) throw new AdminError(404, 'video_not_found');
	if (!found) throw new AdminError(404, 'comment_not_found');
	await send(env, MessageType.CommentDelete, { commentId, videoId, reason: 'admin' });
}

export interface CursorPage<T> {
	items: T[];
	nextCursor: string | null;
}

/** Scans a bucket page by page until `want` matches or `maxScan` objects (playlists, posts have no admin index). */
async function scanMatching(
	bucket: R2Bucket,
	opts: { prefix?: string; cursor?: string | null; want: number; maxScan?: number; keyFilter: (key: string) => boolean; match: (value: Row) => boolean },
): Promise<{ values: Array<{ key: string; value: Row }>; nextCursor: string | null }> {
	const values: Array<{ key: string; value: Row }> = [];
	let cursor = opts.cursor ?? undefined;
	let scanned = 0;
	const maxScan = opts.maxScan ?? 1000;
	do {
		const page = await bucket.list({ prefix: opts.prefix, limit: 100, cursor });
		const keys = page.objects.map((o) => o.key).filter(opts.keyFilter);
		scanned += page.objects.length;
		const objects = await readMany(bucket, keys);
		for (const key of keys) {
			const value = objects.get(key);
			if (value && opts.match(value)) values.push({ key, value });
		}
		cursor = page.truncated ? (page as { cursor?: string }).cursor : undefined;
	} while (cursor && values.length < opts.want && scanned < maxScan);
	return { values, nextCursor: cursor ?? null };
}

const includesText = (q: string | undefined, ...fields: unknown[]) => {
	if (!q?.trim()) return true;
	const needle = q.trim().toLowerCase();
	return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(needle));
};

export async function listPlaylists(env: AdminServiceEnv, query: { q?: string; channelId?: string; ownerId?: string; cursor?: string | null; pageSize?: number }) {
	const { values, nextCursor } = await scanMatching(env.playlists, {
		cursor: query.cursor,
		want: query.pageSize ?? 20,
		keyFilter: (k) => !k.includes('/') && !k.includes(':'),
		match: (p) =>
			p.isDeleted !== true &&
			(!query.channelId || p.channelId === query.channelId) &&
			(!query.ownerId || p.userId === query.ownerId) &&
			includesText(query.q, p.title, p.description, p.id),
	});
	return {
		items: values.map(({ key, value: p }) => ({
			id: (p.id as string) || key,
			title: p.title ?? '',
			channelId: p.channelId ?? null,
			ownerId: p.userId ?? null,
			isPublic: p.isPublic !== false,
			videoCount: Array.isArray(p.videos) ? p.videos.length : 0,
			createdAt: p.dateCreated ?? null,
		})),
		nextCursor,
	};
}

export async function deletePlaylist(env: AdminServiceEnv, id: string): Promise<void> {
	const playlist = await repo(env.playlists).getObject(id);
	if (!playlist) throw new AdminError(404, 'playlist_not_found');
	await env.playlists.delete(id);
	if (playlist.channelId) {
		await repo(env.channels)
			.updateObject(playlist.channelId, (ch) => {
				if (!Array.isArray(ch.playlists) || !ch.playlists.includes(id)) return false;
				ch.playlists = ch.playlists.filter((p: string) => p !== id);
				return true;
			})
			.catch(() => null);
	}
	await send(env, MessageType.PlaylistDelete, { playlistId: id, userId: playlist.userId, channelId: playlist.channelId, reason: 'admin' });
}

const POST_KEY = /^posts\/([^/]+)\/([^/]+)\.json$/;

export async function listPosts(env: AdminServiceEnv, query: { q?: string; channelId?: string; ownerId?: string; cursor?: string | null; pageSize?: number }) {
	const { values, nextCursor } = await scanMatching(env.community_posts, {
		prefix: query.channelId ? `posts/${query.channelId}/` : 'posts/',
		cursor: query.cursor,
		want: query.pageSize ?? 20,
		keyFilter: (k) => {
			const m = POST_KEY.exec(k);
			return !!m && m[2] !== 'index';
		},
		match: (p) => p.status !== 'deleted' && p.isDeleted !== true && (!query.ownerId || p.userId === query.ownerId) && includesText(query.q, p.content, p.id),
	});
	return {
		items: values.map(({ key, value: p }) => ({
			id: (p.id as string) || POST_KEY.exec(key)![2],
			channelId: (p.channelId as string) || POST_KEY.exec(key)![1],
			ownerId: p.userId ?? null,
			type: p.type ?? null,
			text: typeof p.content === 'string' ? p.content : '',
			likes: Number(p.likes) || 0,
			comments: Number(p.comments) || 0,
			createdAt: p.createdAt ?? null,
		})),
		nextCursor,
	};
}

export async function deletePost(env: AdminServiceEnv, channelId: string, postId: string): Promise<void> {
	const key = `posts/${channelId}/${postId}.json`;
	let wasDeleted = false;
	const saved = await repo(env.community_posts).updateObject(key, (post) => {
		wasDeleted = post.status === 'deleted';
		if (wasDeleted) return false;
		post.status = 'deleted';
		post.updatedAt = now();
		return true;
	});
	if (!saved || wasDeleted) throw new AdminError(404, 'post_not_found');
	await repo<{ postIds: string[]; lastUpdated: string }>(env.community_posts)
		.updateObject(`posts/${channelId}/index.json`, (index) => {
			if (!Array.isArray(index.postIds) || !index.postIds.includes(postId)) return false;
			index.postIds = index.postIds.filter((id) => id !== postId);
			index.lastUpdated = now();
			return true;
		})
		.catch(() => null);
	await send(env, MessageType.CommunityPostDeleted, { postId, channelId, actor: { userId: 'admin' }, reason: 'admin' });
}

// ---------------------------------------------------------------------------
// Users (videos profiles)
// ---------------------------------------------------------------------------

export async function userDetail(env: AdminServiceEnv, userId: string): Promise<AdminUserDetail> {
	const db = env.SEARCH_DB!;
	const [profile, ban] = await Promise.all([repo(env.profiles).getObject(userId), readBan(db, userId)]);
	if (!profile && !ban) throw new AdminError(404, 'user_not_found');
	const channelIds = await idsOf(env, 'channel', { ownerId: userId });
	const channelRows = channelIds.length
		? await hydrateChannels(
				env,
				(
					await db
						.prepare(
							`SELECT c.*, (SELECT COALESCE(SUM(v.views), 0) FROM content_ownership v WHERE v.kind = 'video' AND v.channel_id = c.id AND v.is_deleted = 0) AS total_views
							 FROM content_ownership c WHERE c.kind = 'channel' AND c.id IN (SELECT value FROM json_each(?)) ORDER BY c.created_at`,
						)
						.bind(JSON.stringify(channelIds))
						.all<Row>()
				).results ?? [],
			)
		: [];
	const channels = [...(await readMany(env.channels, channelIds)).values()];
	const [videos, watchHistory, subscriptions, comments] = await Promise.all([
		idsOf(env, 'video', { ownerId: userId }).then((ids) => ids.length),
		countPrefix(env.watch_history, `${userId}:`),
		subscribedChannelIds(env.NOTIFICATIONS_DB, userId, profile?.subscribedTo ?? []).then((ids) => ids.length).catch(() => 0),
		db.prepare('SELECT COUNT(*) AS n FROM admin_comments WHERE user_id = ?').bind(userId).first<{ n: number }>().then((r) => Number(r?.n) || 0),
	]);
	return {
		...toUserRow(userId, profile, !!ban),
		bio: profile?.bio ?? '',
		timezone: profile?.timezone ?? null,
		updatedAt: profile?.dateModified ?? null,
		ban,
		channels: channelRows,
		counts: {
			videos,
			playlists: channels.reduce((n, ch) => n + (Array.isArray(ch.playlists) ? ch.playlists.length : 0), 0),
			watchHistory,
			subscriptions,
			comments,
		},
	};
}

export interface UserEdit {
	displayName?: string;
	userName?: string;
	bio?: string;
}

export async function updateUser(env: AdminServiceEnv, userId: string, edit: UserEdit): Promise<Row> {
	const saved = await repo(env.profiles).updateObject(userId, (fresh) => {
		if (edit.displayName !== undefined) {
			fresh.displayName = edit.displayName;
			delete fresh.displayNameLocalized;
		}
		if (edit.userName !== undefined) fresh.userName = edit.userName;
		if (edit.bio !== undefined) {
			fresh.bio = edit.bio;
			delete fresh.bioLocalized;
		}
		fresh.dateModified = now();
	});
	if (!saved) throw new AdminError(404, 'user_not_found');
	await send(env, MessageType.ProfileUpdate, { userId });
	return saved;
}

/** Bans a usr_ id on videos and hides their channels and videos. Auth is not involved. */
export async function banUser(env: AdminServiceEnv, userId: string, actorId: string, reason?: string): Promise<AdminCascadeResult & { ban: VideosBan }> {
	const db = env.SEARCH_DB!;
	const ban: VideosBan = { userId, reason: reason?.trim() || null, bannedBy: actorId, bannedAt: now() };
	await writeBan(db, ban);
	const hold = userHold(userId);
	const channels = await cascade(env.channels, await idsOf(env, 'channel', { ownerId: userId }), (ch) => applySuspensionHold(ch as SuspendableRecord, hold));
	const videos = await cascade(env.videos, await idsOf(env, 'video', { ownerId: userId }), (v) => applySuspensionHold(v as SuspendableRecord, hold));
	const live = await cascadeLiveStreams(env, { ownerId: userId }, (s) => applySuspensionHold(s as SuspendableRecord, hold));
	videos.failed += live.failed;
	const failed = channels.failed + videos.failed;
	return { ban, channels: channels.changed, videos: videos.changed, failed, complete: failed === 0 };
}

export async function unbanUser(env: AdminServiceEnv, userId: string): Promise<AdminCascadeResult> {
	const removed = await deleteBan(env.SEARCH_DB!, userId);
	if (!removed) throw new AdminError(404, 'not_banned');
	const hold = userHold(userId);
	const channels = await cascade(env.channels, await idsOf(env, 'channel', { ownerId: userId }), (ch) => liftSuspensionHold(ch as SuspendableRecord, hold));
	const videos = await cascade(env.videos, await idsOf(env, 'video', { ownerId: userId }), (v) => liftSuspensionHold(v as SuspendableRecord, hold));
	const live = await cascadeLiveStreams(env, { ownerId: userId }, (s) => liftSuspensionHold(s as SuspendableRecord, hold));
	videos.failed += live.failed;
	const failed = channels.failed + videos.failed;
	return { channels: channels.changed, videos: videos.changed, failed, complete: failed === 0 };
}

/**
 * Erases the user's videos data (profile, channels, videos and their media,
 * playlists, history, comments, likes, subscriptions) with the privacy-erase
 * path. A ban, if any, is kept. Auth is not involved: their account and
 * sign-in keep working, and signing in to videos again starts a new, empty
 * profile (unless banned). Resumable: call again with `resumeToken` while
 * `complete` is false.
 */
export async function deleteUserData(env: AdminServiceEnv & Record<string, unknown>, userId: string, resumeToken?: string) {
	const b = await bunny(env);
	const budget = new OperationBudget(900);
	const summary = await eraseUserData(
		env as never,
		userId,
		budget,
		{
			onVideoDeleted: async (videoId: string) => {
				if (!b) return;
				try {
					await b.client.deleteVideo(b.libraryId, videoId);
				} catch (error) {
					logger.warn('[Admin] Bunny Stream delete failed', { videoId, error: error instanceof Error ? error.message : String(error) });
				}
			},
		},
		{ resumeToken },
	);
	if (env.NOTIFICATIONS_DB) {
		for (const videoId of summary.deletedVideoIds) {
			await env.NOTIFICATIONS_DB.batch([
				env.NOTIFICATIONS_DB.prepare('DELETE FROM notifications WHERE entity_id = ?').bind(videoId),
				env.NOTIFICATIONS_DB.prepare('DELETE FROM liked_videos WHERE video_id = ?').bind(videoId),
			]).catch(() => undefined);
		}
	}
	if (summary.complete) await send(env, MessageType.UserDataErased, { userId });
	for (const videoId of summary.deletedVideoIds) await send(env, MessageType.VideoDelete, { videoId, userId, reason: 'admin-erasure' });
	return summary;
}
