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
	deletedChannelHold,
	deletedUserHold,
	isHeldBy,
	LEGACY_RESTORE_TARGET,
	liftSuspensionHold,
	userHold,
	type AdminChannelDetail,
	type AdminDeletion,
	type AdminDeletionKind,
	type AdminJob,
	type AdminJobKind,
	type AdminUserDetail,
	type AdminVideoDetail,
	type SuspendableRecord,
	type SuspensionInfo,
	type VideosBan,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import { isSystemPlaylist } from '../library';
import Queue, { MessageType } from '../queue';
import { claimHandle, handleKey, normalizeHandleInput, releaseHandle, releaseReplacedHandle } from '../channelHandles';
import { pickNewMainChannel, removeChannelPostsAndSections, softDeleteChannelObjectsStep, type OwnedChannelSummary } from '../channelDeletion';
import { findStoredComment, removeStoredComment, type StoredComment } from '../comments';
import { subscriberCounts, subscribedChannelIds } from '../subscription-store';
import { eraseUserData } from '../privacy/user-data';
import { OperationBudget } from '../privacy/scan';
import { RUN_USER_SWEEP_ACTOR, eraseRunUserData } from '../privacy/run-user-erase';
import { BunnyStreamClient } from '../bunny/stream';
import { bunnyClientForVideo, type LibraryHints } from '../bunny/libraries';
import { removeCollectionsFor, renameCollectionsForChannel, renameCollectionsForUser, userCollectionName } from '../channelCollection';
import { purgeVideoMedia, type MediaEnv } from '../media/r2-delivery';
import { readAssignment } from '../creatorTiers';
import { bansFor, deleteBan, readBan, writeBan } from './bans';
import { createJob, type JobHandler, type JobOutcome, type JobQueue } from './jobs';
import { pendingDeletion, recordDeletion, removeDeletion, requestPurge, type PurgeOutcome } from './deletions';
import { forgetPendingUserDeletion } from './pendingUserDeletion';
import { approvedFromPlan, planLegacyRestore, runLegacyRestore, type ApprovedRestore, type AuthUsersDb } from './legacy-restore';
import { OWNER_DELETED_HOLD } from '../videoTrashMarks';
import { runThumbnailRepairStep, type ThumbnailRepairEnv } from '../thumbnail/repair';
import { runOwnershipRebuildStep, type OwnershipRebuildEnv } from '../search/ownershipRebuild';
import { runPlaylistAddStep, type PlaylistEnv } from '../playlistBulk';
import {
	channelVideoStats,
	contentIds,
	countPrefix,
	ensureAdminIndex,
	hydrateChannels,
	readMany,
	toUserRow,
	type AdminEnv,
	adminR2Detail,
} from './directory';

type Row = Record<string, any>;

export interface AdminServiceEnv extends AdminEnv {
	queue?: Queue | { send(message: unknown): Promise<void> };
	channel_tabs?: R2Bucket;
	channel_sections?: R2Bucket;
	'bunny-stream-key'?: { text(): Promise<string> } | string;
	bunny_stream_library_id?: { text(): Promise<string> } | string;
	/** Legacy Bunny library of older videos (lib/bunny/libraries.ts) */
	BUNNY_LEGACY_LIBRARY_ID?: string;
	BUNNY_LEGACY_STREAM_KEY?: unknown;
	/** The admin-jobs queue (heavy actions run from it; lib/admin/jobs.ts). */
	ADMIN_JOBS_QUEUE?: JobQueue;
	/** Auth service D1, read only (verified emails for the legacy profile restore). */
	AUTH_DB?: AuthUsersDb;
	/** Private bucket for pre-change copies written by admin jobs. */
	ADMIN_BACKUPS?: R2Bucket;
}

export class AdminError extends Error {
	constructor(public status: 400 | 403 | 404 | 409 | 422, public code: string, message?: string) {
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

/** Stream API client for the library `video` lives in (lib/bunny/libraries.ts); null when unavailable */
async function bunny(env: AdminServiceEnv, video?: LibraryHints | null): Promise<{ client: BunnyStreamClient; libraryId: number } | null> {
	try {
		return await bunnyClientForVideo(env as never, video);
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

/**
 * Ids for a read-only view (the admin user page): always from the ownership index, even while a
 * pass is rebuilding it, as the admin lists do (#860). idsOf's fallback lists and reads every
 * object in the bucket and ensureAdminIndex runs a heal step inline; on QA's buckets that made the
 * user page take over 40 s for every user (INV-01, 2026-11-11). The lists keep the index healing,
 * and every write updates its row (withSearchSync), so a new channel shows within seconds.
 * Cascades (ban, delete, transfer) keep idsOf, which stays exact.
 */
async function indexedIdsOf(env: AdminServiceEnv, kind: 'video' | 'channel', by: { channelId?: string; ownerId?: string }): Promise<string[]> {
	if (!env.SEARCH_DB) return idsOf(env, kind, by);
	return contentIds(env.SEARCH_DB, kind, by);
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

/** A cascade step's outcome: done, or an error (so the job retries) when some records failed. */
function finish(result: Record<string, unknown>, failed: number): JobOutcome {
	if (failed > 0) throw new Error(`${failed} record(s) could not be updated; retrying (${JSON.stringify(result)})`);
	return { done: true, result };
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
	// The channel's Bunny collections follow its name (lib/channelCollection.ts)
	if (edit.name !== undefined && saved.name !== existing.name) await renameCollectionsForChannel(env as never, id, saved);
	await send(env, MessageType.ChannelUpdate, { channelId: id, userId: saved.userId });
	return saved;
}

/**
 * Suspends a channel: the channel itself is hidden at once (its owner still
 * sees it with a notice); a job then hides its videos and live streams.
 */
export async function suspendChannel(env: AdminServiceEnv, id: string, actorId: string, reason?: string): Promise<{ job: AdminJob }> {
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
	await send(env, MessageType.ChannelUpdate, { channelId: id, userId: saved.userId, action: 'suspended' });
	return { job: await createJob(env, { kind: 'channel.sync-holds', targetKind: 'channel', targetId: id, actorId }) };
}

export async function unsuspendChannel(env: AdminServiceEnv, id: string, actorId: string): Promise<{ job: AdminJob }> {
	const hold = channelHold(id);
	const saved = await repo(env.channels).updateObject(id, (fresh) => {
		fresh.isSuspended = false;
		delete fresh.suspension;
		liftSuspensionHold(fresh as SuspendableRecord, hold);
		fresh.dateModified = now();
	});
	if (!saved) throw new AdminError(404, 'channel_not_found');
	await send(env, MessageType.ChannelUpdate, { channelId: id, userId: saved.userId, action: 'unsuspended' });
	return { job: await createJob(env, { kind: 'channel.sync-holds', targetKind: 'channel', targetId: id, actorId }) };
}

/**
 * Job channel.sync-holds: the channel's videos and live streams follow its
 * current suspension state, whichever action queued the job. A suspend and a
 * quick unsuspend therefore converge, whatever order their jobs run in.
 */
async function syncChannelHolds(env: AdminServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const id = job.targetId;
	const channel = await repo(env.channels).getObject(id);
	if (!channel) return { done: true, result: { skipped: 'channel_not_found' } };
	const hold = channelHold(id);
	const deletedHold = deletedChannelHold(id);
	const deleted = channel.isDeleted === true;
	const suspended = channel.isSuspended === true && !deleted;
	const follow = (r: Row, h: string, on: boolean) => (on ? applySuspensionHold(r as SuspendableRecord, h) : liftSuspensionHold(r as SuspendableRecord, h));
	const mutate = (r: Row) => {
		// Both holds are always brought in line (no short-circuit)
		const suspension = follow(r, hold, suspended);
		const deletion = follow(r, deletedHold, deleted);
		return suspension || deletion;
	};
	const videos = await cascade(env.videos, await idsOf(env, 'video', { channelId: id }), mutate);
	const live = await cascadeLiveStreams(env, { channelId: id }, mutate);
	// A soft-deleted channel's playlists are hidden with it (restored with it)
	const playlistIds = Array.isArray(channel.playlists) ? (channel.playlists as unknown[]).filter((p): p is string => typeof p === 'string') : [];
	const playlists = await cascade(env.playlists, playlistIds, (r) => (r.channelId === id ? follow(r, deletedHold, deleted) : false));
	return finish(
		{ suspended, deleted, videos: videos.changed, liveStreams: live.changed, playlists: playlists.changed },
		videos.failed + live.failed + playlists.failed,
	);
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
 * owner must have a videos profile and must not be banned (checked now); the
 * move itself is a job. Per-channel roles live with the channel and move with it.
 */
export async function transferChannel(env: AdminServiceEnv, id: string, newOwnerId: string, actorId: string): Promise<{ job: AdminJob }> {
	const channel = await repo(env.channels).getObject(id);
	if (!channel || channel.isDeleted) throw new AdminError(404, 'channel_not_found');
	if (channel.userId === newOwnerId) throw new AdminError(409, 'already_owner');
	const target = await repo(env.profiles).getObject(newOwnerId);
	if (!target || target.isDeleted === true) throw new AdminError(404, 'new_owner_not_found');
	// A banned (suspended) videos user cannot receive a channel
	if (env.SEARCH_DB && (await readBan(env.SEARCH_DB, newOwnerId))) throw new AdminError(409, 'new_owner_banned');
	logger.info('[Admin] Channel transfer queued', { channelId: id, newOwnerId, previousOwnerId: channel.userId ?? null, actorId });
	// Decided now, so a retried job does not re-decide from a half-moved state
	const makeMain = (await idsOf(env, 'channel', { ownerId: newOwnerId })).length === 0;
	return {
		job: await createJob(env, {
			kind: 'channel.transfer',
			targetKind: 'channel',
			targetId: id,
			actorId,
			params: { newOwnerId, previousOwnerId: channel.userId ?? null, wasMain: channel.isMain === true, makeMain },
		}),
	};
}

/** Job channel.transfer. Every step is idempotent, so a retry finishes a partial move. */
async function runTransfer(env: AdminServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const id = job.targetId;
	const { newOwnerId, previousOwnerId, wasMain, makeMain } = job.params as { newOwnerId: string; previousOwnerId: string | null; wasMain: boolean; makeMain: boolean };
	const saved = await repo(env.channels).updateObject(id, (fresh) => {
		if (fresh.isDeleted) return false;
		if (fresh.userId === newOwnerId) return false;
		fresh.userId = newOwnerId;
		fresh.isMain = makeMain;
		// Owners hold no member role: a new owner who was a member loses that entry
		if (Array.isArray(fresh.members)) fresh.members = fresh.members.filter((m: { userId?: string }) => m?.userId !== newOwnerId);
		fresh.dateModified = now();
		return true;
	});
	if (!saved) return { done: true, result: { skipped: 'channel_not_found' } };
	if (saved.isDeleted) return { done: true, result: { skipped: 'channel_deleted' } };
	await repo(env.profiles).updateObject(newOwnerId, (profile) => {
		const list: string[] = Array.isArray(profile.channels) ? profile.channels : [];
		if (list.includes(id)) return false;
		profile.channels = [...list, id];
		return true;
	});
	if (previousOwnerId) {
		await removeFromProfile(env, previousOwnerId, id);
		if (wasMain) await promoteNextMain(env, previousOwnerId, id);
	}
	const videos = await cascade(env.videos, await idsOf(env, 'video', { channelId: id }), (v) => {
		if (v.userId === newOwnerId) return false;
		v.userId = newOwnerId;
		return true;
	});
	const playlistIds = Array.isArray(saved.playlists) ? (saved.playlists as string[]).filter((p) => typeof p === 'string') : [];
	const playlists = await cascade(env.playlists, playlistIds, (p) => {
		if (p.channelId !== id || p.userId === newOwnerId) return false;
		p.userId = newOwnerId;
		return true;
	});
	const failed = videos.failed + playlists.failed;
	if (failed === 0) await send(env, MessageType.ChannelUpdate, { channelId: id, userId: newOwnerId, previousOwnerId, action: 'transferred' });
	return finish({ videos: videos.changed, playlists: playlists.changed, previousOwnerId }, failed);
}

/**
 * Deletes a video's stored data, media and per-video records (the privacy-erase
 * path). Idempotent: a video already gone from R2 or Bunny counts as erased.
 * `strict` (jobs) throws when Bunny or the notification cleanup fails, so the
 * job retries instead of leaving media behind.
 */
async function purgeVideo(
	env: AdminServiceEnv,
	videoId: string,
	video: Row | null,
	bunnyClient?: { client: BunnyStreamClient; libraryId: number } | null,
	opts: { strict?: boolean } = { strict: true },
): Promise<void> {
	// The Bunny library comes from the record (read it before it is gone)
	let hints: LibraryHints | null = video;
	if (bunnyClient === undefined && !video?.bunnyLibraryId && !video?.playUrl) {
		hints = (await repo(env.videos).getObject(videoId).catch(() => null)) ?? video;
	}
	await env.videos.delete(videoId);
	// R2 renditions (epic #687), both buckets; strict jobs retry when it fails
	try {
		await purgeVideoMedia(env as unknown as MediaEnv, videoId);
	} catch (error) {
		logger.warn('[Admin] R2 media delete failed', { videoId, error: error instanceof Error ? error.message : String(error) });
		if (opts.strict) throw error;
	}
	const b = bunnyClient === undefined ? await bunny(env, hints) : bunnyClient;
	if (!b && opts.strict) throw new Error('Bunny Stream is unavailable');
	if (b) {
		try {
			await b.client.deleteVideo(b.libraryId, videoId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// Already gone from Bunny: nothing left to erase there
			if (!/status: 404/.test(message)) {
				logger.warn('[Admin] Bunny Stream delete failed', { videoId, error: message });
				if (opts.strict) throw new Error(`Bunny Stream delete failed for ${videoId}: ${message}`);
			}
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
			if (opts.strict) throw error;
		}
	}
	await send(env, MessageType.VideoDelete, { videoId, userId: video?.userId, channelId: video?.channelId, reason: 'admin' });
}

/** What a soft delete changed on the record, so a restore can put it back. */
interface AdminDeletionMark {
	at: string;
	by: string;
	reason?: string;
	wasMain?: boolean;
}

const cleanReason = (reason?: string | null) => (reason?.trim() ? reason.trim().slice(0, 1000) : undefined);

/** A pending deletion that can still be restored (or 404/409). */
async function restorable(env: AdminServiceEnv, kind: AdminDeletionKind, id: string): Promise<AdminDeletion> {
	const deletion = await pendingDeletion(env.SEARCH_DB!, kind, id);
	if (!deletion) throw new AdminError(404, 'deletion_not_found');
	if (deletion.purgeStartedAt) throw new AdminError(409, 'purge_in_progress', 'Permanent deletion has started; it can no longer be restored');
	return deletion;
}

/**
 * Soft-deletes a channel (restorable for 30 days; lib/admin/deletions.ts): the
 * record is marked deleted and held hidden at once, it leaves its owner's
 * profile (another channel becomes main), and a job hides its videos, live
 * streams and playlists. Its handle stays reserved, so a restore gets it
 * back. Nothing is erased until the cleanup purges it.
 */
export async function deleteChannel(env: AdminServiceEnv, id: string, actorId: string, reason?: string): Promise<{ deletion: AdminDeletion; job: AdminJob }> {
	const channel = await repo(env.channels).getObject(id);
	if (!channel || channel.isDeleted) throw new AdminError(404, 'channel_not_found');
	const at = now();
	const mark: AdminDeletionMark = { at, by: actorId, ...(cleanReason(reason) ? { reason: cleanReason(reason) } : {}), wasMain: channel.isMain === true };
	const saved = await repo(env.channels).updateObject(id, (fresh) => {
		if (fresh.isDeleted) return false;
		fresh.isDeleted = true;
		fresh.deletedAt = at;
		fresh.deletedBy = actorId;
		fresh.adminDeletion = { ...mark, wasMain: fresh.isMain === true };
		applySuspensionHold(fresh as SuspendableRecord, deletedChannelHold(id));
		fresh.isMain = false;
		fresh.dateModified = at;
		return true;
	});
	if (!saved || saved.adminDeletion?.at !== at) throw new AdminError(404, 'channel_not_found');
	const deletion = await recordDeletion(env.SEARCH_DB!, {
		kind: 'channel',
		id,
		title: channel.name ?? channel.handle ?? id,
		ownerId: channel.userId ?? null,
		channelId: id,
		deletedBy: actorId,
		reason: mark.reason,
		deletedAt: at,
	});
	if (channel.userId) {
		await removeFromProfile(env, channel.userId, id);
		if (channel.isMain) await promoteNextMain(env, channel.userId, id);
	}
	await send(env, MessageType.ChannelUpdate, { channelId: id, userId: channel.userId, action: 'deleted' });
	return { deletion, job: await createJob(env, { kind: 'channel.sync-holds', targetKind: 'channel', targetId: id, actorId }) };
}

/** Restores a soft-deleted channel: back on its owner's profile (main again if they have none), un-hidden with its content. */
export async function restoreChannel(env: AdminServiceEnv, id: string, actorId: string): Promise<{ job: AdminJob }> {
	await restorable(env, 'channel', id);
	let mark: AdminDeletionMark | undefined;
	const saved = await repo(env.channels).updateObject(id, (fresh) => {
		mark = fresh.adminDeletion as AdminDeletionMark | undefined;
		fresh.isDeleted = false;
		delete fresh.deletedAt;
		delete fresh.deletedBy;
		delete fresh.adminDeletion;
		liftSuspensionHold(fresh as SuspendableRecord, deletedChannelHold(id));
		fresh.dateModified = now();
	});
	if (!saved) throw new AdminError(404, 'channel_not_found');
	await removeDeletion(env.SEARCH_DB!, 'channel', id);
	if (saved.userId) {
		await repo(env.profiles)
			.updateObject(saved.userId, (profile) => {
				const list: string[] = Array.isArray(profile.channels) ? profile.channels : [];
				if (list.includes(id)) return false;
				profile.channels = [...list, id];
				return true;
			})
			.catch((error) => logger.warn('[Admin] Could not put the restored channel back on its profile', { channelId: id, error: error instanceof Error ? error.message : String(error) }));
		if (mark?.wasMain) {
			const others = (await idsOf(env, 'channel', { ownerId: saved.userId })).filter((c) => c !== id);
			const hasMain = [...(await readMany(env.channels, others)).values()].some((c) => c.isMain === true && c.isDeleted !== true);
			if (!hasMain) {
				await repo(env.channels).updateObject(id, (ch) => {
					if (ch.isMain === true) return false;
					ch.isMain = true;
					return true;
				});
			}
		}
	}
	await send(env, MessageType.ChannelUpdate, { channelId: id, userId: saved.userId, action: 'restored' });
	return { job: await createJob(env, { kind: 'channel.sync-holds', targetKind: 'channel', targetId: id, actorId }) };
}

/** Playlist objects scanned per channel.purge step (playlists have no per-channel index). */
const PLAYLIST_SCAN_STEP = 500;

/**
 * Job channel.purge: erases a deleted channel's videos and content, in steps.
 * Step 1 erases the videos (found through the ownership index) and the posts
 * and sections (prefix deletes). Then the playlists bucket is scanned in
 * bounded steps, each a fresh job delivery, so no single run is long and a
 * large bucket is never cut off. Idempotent: a retried step redoes only itself.
 */
async function purgeChannel(env: AdminServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const id = job.targetId;
	const p = job.params;
	const userId = (p.userId as string | null) ?? null;
	if (p.stage !== 'playlists') {
		const channel = await repo(env.channels).getObject(id);
		if (channel && channel.isDeleted !== true) return { done: true, result: { skipped: 'channel_not_deleted' } };
		if (channel && env.channel_tabs) {
			// The handle stayed reserved while the channel could be restored
			await releaseHandle(env.channel_tabs, channel.handle, id);
			await env.channel_tabs.delete(`channel-tabs/${id}`);
		}
		const videoIds = await idsOf(env, 'video', { channelId: id });
		let failed = 0;
		await eachLimited(videoIds, 6, async (videoId) => {
			try {
				// Each video is deleted from its own Bunny library
				await purgeVideo(env, videoId, { userId, channelId: id });
			} catch (error) {
				failed++;
				logger.warn('[Admin] Video purge failed', { videoId, error: error instanceof Error ? error.message : String(error) });
			}
		});
		if (failed > 0) return finish({ videos: videoIds.length - failed }, failed);
		const { posts, sections } = await removeChannelPostsAndSections(env, id);
		const result = { videos: videoIds.length, posts, sections };
		return { done: false, params: { ...p, stage: 'playlists', ...result, playlists: 0, scanned: 0 }, result };
	}
	const step = await softDeleteChannelObjectsStep(env.playlists, id, { cursor: p.cursor as string | undefined, budget: PLAYLIST_SCAN_STEP, hard: true });
	// A failed write retries this step (from its own cursor), never skips it
	if (step.failed > 0) return finish({ playlists: p.playlists, cursor: p.cursor ?? null }, step.failed);
	const result = { videos: p.videos, posts: p.posts, sections: p.sections, playlists: Number(p.playlists ?? 0) + step.removed, scanned: Number(p.scanned ?? 0) + step.scanned };
	if (step.cursor) return { done: false, params: { ...p, ...result, cursor: step.cursor }, result };
	// The channel's Bunny collections (a soft-deleted channel kept them; lib/channelCollection.ts)
	const purgedChannel = await repo(env.channels).getObject(id);
	if (purgedChannel) await removeCollectionsFor(env as never, id, purgedChannel);
	// Last: the record itself (the deletion row and the admin audit log keep the history)
	await env.channels.delete(id);
	await send(env, MessageType.ChannelDelete, { channelId: id, userId, reason: 'admin' });
	return { done: true, result };
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

export async function videoDetail(env: AdminServiceEnv, id: string): Promise<AdminVideoDetail> {
	const video = await repo(env.videos).getObject(id);
	if (!video || id.includes(':')) throw new AdminError(404, 'video_not_found');
	const channel = video.channelId ? await repo(env.channels).getObject(video.channelId) : null;
	let processing: AdminVideoDetail['processing'] = null;
	const b = await bunny(env, video);
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
		processingIssue:
			video.processingIssue && typeof video.processingIssue === 'object' && typeof video.processingIssue.kind === 'string'
				? { kind: video.processingIssue.kind, ...(typeof video.processingIssue.reason === 'string' ? { reason: video.processingIssue.reason.slice(0, 300) } : {}), at: String(video.processingIssue.at ?? '') }
				: null,
		r2: adminR2Detail(video),
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
			// A new thumbnail ends any shape flag on the old one
			delete fresh.thumbnailCheck;
		}
		fresh.dateModified = now();
	});
	if (!saved) throw new AdminError(404, 'video_not_found');
	await send(env, MessageType.VideoEdit, { videoId: id, userId: saved.userId, channelId: saved.channelId });
	return saved;
}

/** Checks the move now and queues it (video.move). */
export async function moveVideo(env: AdminServiceEnv, id: string, channelId: string, actorId: string): Promise<{ job: AdminJob }> {
	const [video, target] = await Promise.all([repo(env.videos).getObject(id), repo(env.channels).getObject(channelId)]);
	if (!video || id.includes(':') || video.isDeleted) throw new AdminError(404, 'video_not_found');
	if (!target || target.isDeleted) throw new AdminError(404, 'channel_not_found');
	return { job: await createJob(env, { kind: 'video.move', targetKind: 'video', targetId: id, actorId, params: { channelId, fromChannelId: video.channelId ?? null } }) };
}

/** Job video.move: into the channel (and to its owner); suspension holds follow the channel. Idempotent. */
async function runMove(env: AdminServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const id = job.targetId;
	const channelId = job.params.channelId as string;
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
	if (!saved) return { done: true, result: { skipped: 'video_not_found' } };
	if (saved.channelId !== channelId) throw new Error('The video did not move');
	await send(env, MessageType.VideoEdit, { videoId: id, userId: saved.userId, channelId });
	return { done: true, result: { channelId, ownerId: saved.userId ?? null } };
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
	const b = await bunny(env, video);
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

/**
 * Soft-deletes a video (restorable for 30 days; lib/admin/deletions.ts): marked
 * deleted and held hidden at once, so every public read, list, feed and index
 * drops it. Its media and records stay until the cleanup purges it.
 */
export async function deleteVideo(env: AdminServiceEnv, id: string, actorId: string, reason?: string): Promise<{ deletion: AdminDeletion }> {
	if (id.includes(':')) throw new AdminError(404, 'video_not_found');
	const at = now();
	const mark: AdminDeletionMark = { at, by: actorId, ...(cleanReason(reason) ? { reason: cleanReason(reason) } : {}) };
	const saved = await repo(env.videos).updateObject(id, (fresh) => {
		if (fresh.isDeleted === true) return false;
		fresh.isDeleted = true;
		fresh.deletedAt = at;
		fresh.adminDeletion = mark;
		applySuspensionHold(fresh as SuspendableRecord, ADMIN_DELETED_HOLD);
		fresh.dateModified = at;
		return true;
	});
	if (!saved || (saved.adminDeletion as AdminDeletionMark | undefined)?.at !== at) throw new AdminError(404, 'video_not_found');
	const deletion = await recordDeletion(env.SEARCH_DB!, {
		kind: 'video',
		id,
		title: saved.title ?? id,
		ownerId: saved.userId ?? null,
		channelId: saved.channelId ?? null,
		deletedBy: actorId,
		reason: mark.reason,
		deletedAt: at,
	});
	await send(env, MessageType.VideoEdit, { videoId: id, userId: saved.userId, channelId: saved.channelId, action: 'deleted' });
	return { deletion };
}

/** The hold a soft-deleted video, playlist or profile carries on itself (lifted on restore). */
const ADMIN_DELETED_HOLD = 'admin:deleted';

export async function restoreVideo(env: AdminServiceEnv, id: string): Promise<Row> {
	await restorable(env, 'video', id);
	const saved = await repo(env.videos).updateObject(id, (fresh) => {
		// An admin restores admin deletes and creator deletes (lib/videoTrash.ts) alike
		if (!fresh.adminDeletion && !fresh.ownerDeletion) return false;
		fresh.isDeleted = false;
		delete fresh.deletedAt;
		delete fresh.deletedBy;
		delete fresh.adminDeletion;
		delete fresh.ownerDeletion;
		liftSuspensionHold(fresh as SuspendableRecord, ADMIN_DELETED_HOLD);
		liftSuspensionHold(fresh as SuspendableRecord, OWNER_DELETED_HOLD);
		fresh.dateModified = now();
		return true;
	});
	if (!saved) throw new AdminError(404, 'video_not_found');
	await removeDeletion(env.SEARCH_DB!, 'video', id);
	await send(env, MessageType.VideoEdit, { videoId: id, userId: saved.userId, channelId: saved.channelId, action: 'restored' });
	return saved;
}

/** Job video.purge (started only by the cleanup). Idempotent: an erased video is simply gone; a restored one is skipped. */
async function runVideoPurge(env: AdminServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const video = await repo(env.videos).getObject(job.targetId);
	if (video && video.isDeleted !== true) return { done: true, result: { skipped: 'video_not_deleted' } };
	await purgeVideo(env, job.targetId, { userId: job.params.userId, channelId: job.params.channelId }, undefined, { strict: true });
	return { done: true };
}

// ---------------------------------------------------------------------------
// Comments, playlists, community posts
// ---------------------------------------------------------------------------

/** Soft-deletes a video comment (or reply): hidden at once (isDeleted), removed by the cleanup. */
export async function deleteComment(env: AdminServiceEnv, videoId: string, commentId: string, actorId = 'admin', reason?: string): Promise<{ deletion: AdminDeletion }> {
	let found: StoredComment | null = null;
	const at = now();
	const mark: AdminDeletionMark = { at, by: actorId, ...(cleanReason(reason) ? { reason: cleanReason(reason) } : {}) };
	const saved = await repo(env.videos).updateObject(videoId, (fresh) => {
		const target = findStoredComment(fresh.comments as StoredComment[], commentId);
		found = target && target.comment.isDeleted !== true ? target.comment : null;
		if (!found) return false;
		found.isDeleted = true;
		(found as StoredComment & { adminDeletion?: AdminDeletionMark }).adminDeletion = mark;
		return true;
	});
	if (!saved) throw new AdminError(404, 'video_not_found');
	const comment = found as StoredComment | null;
	if (!comment) throw new AdminError(404, 'comment_not_found');
	const deletion = await recordDeletion(env.SEARCH_DB!, {
		kind: 'comment',
		id: commentId,
		parentId: videoId,
		title: comment.text ?? '',
		ownerId: comment.userId ?? null,
		channelId: comment.channelId ?? null,
		deletedBy: actorId,
		reason: mark.reason,
		deletedAt: at,
	});
	await send(env, MessageType.CommentDelete, { commentId, videoId, reason: 'admin' });
	return { deletion };
}

export async function restoreComment(env: AdminServiceEnv, commentId: string): Promise<void> {
	const deletion = await restorable(env, 'comment', commentId);
	const videoId = deletion.parentId!;
	let restored = false;
	await repo(env.videos).updateObject(videoId, (fresh) => {
		const target = findStoredComment(fresh.comments as StoredComment[], commentId);
		const comment = target?.comment as (StoredComment & { adminDeletion?: AdminDeletionMark }) | undefined;
		restored = !!comment?.adminDeletion;
		if (!comment || !restored) return false;
		comment.isDeleted = false;
		delete comment.adminDeletion;
		return true;
	});
	if (!restored) throw new AdminError(404, 'comment_not_found');
	await removeDeletion(env.SEARCH_DB!, 'comment', commentId);
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

/** The string values of a per-language map (titleLocalized and the like). */
const localizedValues = (map: unknown): string[] =>
	map && typeof map === 'object' ? Object.values(map as Record<string, unknown>).filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];

export async function listPlaylists(env: AdminServiceEnv, query: { q?: string; channelId?: string; ownerId?: string; cursor?: string | null; pageSize?: number }) {
	const { values, nextCursor } = await scanMatching(env.playlists, {
		cursor: query.cursor,
		want: query.pageSize ?? 20,
		keyFilter: (k) => !k.includes('/') && !k.includes(':'),
		match: (p) =>
			p.isDeleted !== true &&
			// A channel's playlists never include a user's Watch later
			(!query.channelId || (p.channelId === query.channelId && !isSystemPlaylist(p as never))) &&
			(!query.ownerId || p.userId === query.ownerId) &&
			includesText(query.q, p.title, p.description, p.id, ...localizedValues(p.titleLocalized), ...localizedValues(p.descriptionLocalized)),
	});
	return {
		items: values.map(({ key, value: p }) => ({
			id: (p.id as string) || key,
			title: p.title ?? '',
			...(localizedValues(p.titleLocalized).length ? { titleLocalized: p.titleLocalized as Record<string, string> } : {}),
			channelId: p.channelId ?? null,
			ownerId: p.userId ?? null,
			isPublic: p.isPublic !== false,
			videoCount: Array.isArray(p.videos) ? p.videos.length : 0,
			createdAt: p.dateCreated ?? null,
		})),
		nextCursor,
	};
}

/** Soft-deletes a playlist: hidden at once and off its channel's list; removed by the cleanup. */
export async function deletePlaylist(env: AdminServiceEnv, id: string, actorId = 'admin', reason?: string): Promise<{ deletion: AdminDeletion }> {
	const at = now();
	const mark: AdminDeletionMark = { at, by: actorId, ...(cleanReason(reason) ? { reason: cleanReason(reason) } : {}) };
	const saved = id.includes('/') || id.includes(':') ? null : await repo(env.playlists).updateObject(id, (fresh) => {
		if (fresh.isDeleted === true) return false;
		fresh.isDeleted = true;
		fresh.deletedAt = at;
		fresh.adminDeletion = mark;
		applySuspensionHold(fresh as SuspendableRecord, ADMIN_DELETED_HOLD);
		fresh.dateModified = at;
		return true;
	});
	if (!saved || (saved.adminDeletion as AdminDeletionMark | undefined)?.at !== at) throw new AdminError(404, 'playlist_not_found');
	const deletion = await recordDeletion(env.SEARCH_DB!, {
		kind: 'playlist',
		id,
		title: saved.title ?? id,
		ownerId: saved.userId ?? null,
		channelId: saved.channelId ?? null,
		deletedBy: actorId,
		reason: mark.reason,
		deletedAt: at,
	});
	if (saved.channelId) {
		await repo(env.channels)
			.updateObject(saved.channelId, (ch) => {
				if (!Array.isArray(ch.playlists) || !ch.playlists.includes(id)) return false;
				ch.playlists = ch.playlists.filter((p: string) => p !== id);
				return true;
			})
			.catch(() => null);
	}
	await send(env, MessageType.PlaylistEdit, { playlistId: id, userId: saved.userId, channelId: saved.channelId, action: 'deleted' });
	return { deletion };
}

export async function restorePlaylist(env: AdminServiceEnv, id: string): Promise<void> {
	await restorable(env, 'playlist', id);
	const saved = await repo(env.playlists).updateObject(id, (fresh) => {
		// An admin restores admin deletes and creator deletes (lib/videoTrash.ts) alike
		if (!fresh.adminDeletion && !fresh.ownerDeletion) return false;
		fresh.isDeleted = false;
		delete fresh.deletedAt;
		delete fresh.deletedBy;
		delete fresh.adminDeletion;
		delete fresh.ownerDeletion;
		liftSuspensionHold(fresh as SuspendableRecord, ADMIN_DELETED_HOLD);
		liftSuspensionHold(fresh as SuspendableRecord, OWNER_DELETED_HOLD);
		fresh.dateModified = now();
		return true;
	});
	if (!saved) throw new AdminError(404, 'playlist_not_found');
	await removeDeletion(env.SEARCH_DB!, 'playlist', id);
	if (saved.channelId) {
		await repo(env.channels)
			.updateObject(saved.channelId, (ch) => {
				const list: string[] = Array.isArray(ch.playlists) ? ch.playlists : [];
				if (list.includes(id)) return false;
				ch.playlists = [...list, id];
				return true;
			})
			.catch(() => null);
	}
	await send(env, MessageType.PlaylistEdit, { playlistId: id, userId: saved.userId, channelId: saved.channelId, action: 'restored' });
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

type PostIndex = { postIds: string[]; lastUpdated: string };
const postKey = (channelId: string, postId: string) => `posts/${channelId}/${postId}.json`;
const postIndexKey = (channelId: string) => `posts/${channelId}/index.json`;

/** Soft-deletes a community post: status 'deleted' (hidden) and off its channel's index; removed by the cleanup. */
export async function deletePost(env: AdminServiceEnv, channelId: string, postId: string, actorId = 'admin', reason?: string): Promise<{ deletion: AdminDeletion }> {
	const at = now();
	const mark: AdminDeletionMark & { previousStatus?: string } = { at, by: actorId, ...(cleanReason(reason) ? { reason: cleanReason(reason) } : {}) };
	let wasDeleted = false;
	const saved = await repo(env.community_posts).updateObject(postKey(channelId, postId), (post) => {
		wasDeleted = post.status === 'deleted';
		if (wasDeleted) return false;
		post.adminDeletion = { ...mark, previousStatus: post.status ?? 'published' };
		post.status = 'deleted';
		post.updatedAt = at;
		return true;
	});
	if (!saved || wasDeleted) throw new AdminError(404, 'post_not_found');
	const deletion = await recordDeletion(env.SEARCH_DB!, {
		kind: 'post',
		id: postId,
		parentId: channelId,
		title: typeof saved.content === 'string' ? saved.content : '',
		ownerId: saved.userId ?? null,
		channelId,
		deletedBy: actorId,
		reason: mark.reason,
		deletedAt: at,
	});
	await repo<PostIndex>(env.community_posts)
		.updateObject(postIndexKey(channelId), (index) => {
			if (!Array.isArray(index.postIds) || !index.postIds.includes(postId)) return false;
			index.postIds = index.postIds.filter((id) => id !== postId);
			index.lastUpdated = now();
			return true;
		})
		.catch(() => null);
	await send(env, MessageType.CommunityPostDeleted, { postId, channelId, actor: { userId: 'admin' }, reason: 'admin' });
	return { deletion };
}

/** Where a post goes back in its channel's index (newest first), found by binary search on creation dates. */
async function postIndexPosition(env: AdminServiceEnv, channelId: string, postIds: string[], createdAt: number): Promise<number> {
	const createdOf = async (id: string) => {
		const post = await repo(env.community_posts).getObject(postKey(channelId, id)).catch(() => null);
		const at = Date.parse(post?.createdAt ?? '');
		return Number.isFinite(at) ? at : 0;
	};
	let lo = 0;
	let hi = postIds.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((await createdOf(postIds[mid])) > createdAt) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

export async function restorePost(env: AdminServiceEnv, postId: string): Promise<void> {
	const deletion = await restorable(env, 'post', postId);
	const channelId = deletion.parentId!;
	const saved = await repo(env.community_posts).updateObject(postKey(channelId, postId), (post) => {
		const mark = post.adminDeletion as (AdminDeletionMark & { previousStatus?: string }) | undefined;
		if (!mark || post.status !== 'deleted') return false;
		post.status = mark.previousStatus ?? 'published';
		delete post.adminDeletion;
		post.updatedAt = now();
		return true;
	});
	if (!saved || saved.status === 'deleted') throw new AdminError(404, 'post_not_found');
	await removeDeletion(env.SEARCH_DB!, 'post', postId);
	const createdAt = Date.parse(saved.createdAt ?? '') || 0;
	const current = (await repo<PostIndex>(env.community_posts).getObject(postIndexKey(channelId)).catch(() => null))?.postIds ?? [];
	const position = await postIndexPosition(env, channelId, current.filter((id) => id !== postId), createdAt);
	await repo<PostIndex>(env.community_posts)
		.updateObject(
			postIndexKey(channelId),
			(index) => {
				const ids = Array.isArray(index.postIds) ? index.postIds : [];
				if (ids.includes(postId)) return false;
				index.postIds = [...ids.slice(0, position), postId, ...ids.slice(position)];
				index.lastUpdated = now();
				return true;
			},
			{ initial: () => ({ postIds: [], lastUpdated: now() }) },
		)
		.catch((error) => logger.warn('[Admin] Could not put the restored post back in its index', { postId, channelId, error: error instanceof Error ? error.message : String(error) }));
}

// ---------------------------------------------------------------------------
// Users (videos profiles)
// ---------------------------------------------------------------------------

export async function userDetail(env: AdminServiceEnv, userId: string): Promise<AdminUserDetail> {
	const db = env.SEARCH_DB!;
	const [profile, ban] = await Promise.all([repo(env.profiles).getObject(userId), readBan(db, userId)]);
	if (!profile && !ban) throw new AdminError(404, 'user_not_found');
	const channelIds = await indexedIdsOf(env, 'channel', { ownerId: userId });
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
		indexedIdsOf(env, 'video', { ownerId: userId }).then((ids) => ids.length),
		countPrefix(env.watch_history, `${userId}:`),
		subscribedChannelIds(env.NOTIFICATIONS_DB, userId, profile?.subscribedTo ?? []).then((ids) => ids.length).catch(() => 0),
		db.prepare('SELECT COUNT(*) AS n FROM admin_comments WHERE user_id = ?').bind(userId).first<{ n: number }>().then((r) => Number(r?.n) || 0),
	]);
	const creatorTier = await readAssignment(db as unknown as D1Database, userId).catch(() => null);
	return {
		...toUserRow(userId, profile, !!ban),
		creatorTier,
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
	let previousName = '';
	const saved = await repo(env.profiles).updateObject(userId, (fresh) => {
		previousName = userCollectionName(fresh as never, userId);
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
	// The user's Bunny collections follow the name (lib/channelCollection.ts)
	if (userCollectionName(saved as never, userId) !== previousName) await renameCollectionsForUser(env as never, userId, saved as never);
	await send(env, MessageType.ProfileUpdate, { userId });
	return saved;
}

/** Bans a usr_ id on videos (enforced at once); a job hides their channels and videos. Auth is not involved. */
export async function banUser(env: AdminServiceEnv, userId: string, actorId: string, reason?: string): Promise<{ ban: VideosBan; job: AdminJob }> {
	const ban: VideosBan = { userId, reason: reason?.trim() || null, bannedBy: actorId, bannedAt: now() };
	await writeBan(env.SEARCH_DB!, ban);
	return { ban, job: await createJob(env, { kind: 'user.sync-holds', targetKind: 'user', targetId: userId, actorId }) };
}

export async function unbanUser(env: AdminServiceEnv, userId: string, actorId: string): Promise<{ job: AdminJob }> {
	const removed = await deleteBan(env.SEARCH_DB!, userId);
	if (!removed) throw new AdminError(404, 'not_banned');
	return { job: await createJob(env, { kind: 'user.sync-holds', targetKind: 'user', targetId: userId, actorId }) };
}

/** Job user.sync-holds: the user's channels, videos and live streams follow their current ban state. */
async function syncUserHolds(env: AdminServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const userId = job.targetId;
	const banned = !!(await readBan(env.SEARCH_DB!, userId));
	const deleted = !!(await pendingDeletion(env.SEARCH_DB!, 'user', userId));
	const hold = userHold(userId);
	const deletedHold = deletedUserHold(userId);
	const follow = (r: Row, h: string, on: boolean) => (on ? applySuspensionHold(r as SuspendableRecord, h) : liftSuspensionHold(r as SuspendableRecord, h));
	const mutate = (r: Row) => {
		// Both holds are always brought in line (no short-circuit)
		const ban = follow(r, hold, banned);
		const deletion = follow(r, deletedHold, deleted);
		return ban || deletion;
	};
	const channels = await cascade(env.channels, await idsOf(env, 'channel', { ownerId: userId }), mutate);
	const videos = await cascade(env.videos, await idsOf(env, 'video', { ownerId: userId }), mutate);
	const live = await cascadeLiveStreams(env, { ownerId: userId }, mutate);
	return finish({ banned, deleted, channels: channels.changed, videos: videos.changed, liveStreams: live.changed }, channels.failed + videos.failed + live.failed);
}

/**
 * Soft-deletes a user's videos data (restorable for 30 days;
 * lib/admin/deletions.ts): their profile stops being shown and a job hides
 * their channels, videos and live streams. When the cleanup purges it, the
 * privacy-erase path (user.delete-data) erases the profile, channels, videos
 * and their media, playlists, history, comments, likes and subscriptions. A
 * ban, if any, is kept. Auth is not involved: their account and sign-in keep
 * working, and after the purge signing in to videos starts a new, empty
 * profile (unless banned).
 */
export async function deleteUserData(env: AdminServiceEnv, userId: string, actorId: string, reason?: string): Promise<{ deletion: AdminDeletion; job: AdminJob }> {
	if (await pendingDeletion(env.SEARCH_DB!, 'user', userId)) throw new AdminError(409, 'already_deleted');
	const at = now();
	const mark: AdminDeletionMark = { at, by: actorId, ...(cleanReason(reason) ? { reason: cleanReason(reason) } : {}) };
	const profile = await repo(env.profiles).updateObject(userId, (fresh) => {
		fresh.adminDeletion = mark;
		fresh.dateModified = at;
	});
	const deletion = await recordDeletion(env.SEARCH_DB!, {
		kind: 'user',
		id: userId,
		title: (profile?.displayName as string | undefined) || (profile?.userName as string | undefined) || userId,
		ownerId: userId,
		deletedBy: actorId,
		reason: mark.reason,
		deletedAt: at,
	});
	// Writes are refused from now on (middleware/videos-pending-deletion.ts)
	forgetPendingUserDeletion(userId);
	await send(env, MessageType.ProfileUpdate, { userId, action: 'deleted' });
	return { deletion, job: await createJob(env, { kind: 'user.sync-holds', targetKind: 'user', targetId: userId, actorId }) };
}

export async function restoreUser(env: AdminServiceEnv, userId: string, actorId: string): Promise<{ job: AdminJob }> {
	await restorable(env, 'user', userId);
	await repo(env.profiles).updateObject(userId, (fresh) => {
		if (!fresh.adminDeletion) return false;
		delete fresh.adminDeletion;
		fresh.dateModified = now();
		return true;
	});
	await removeDeletion(env.SEARCH_DB!, 'user', userId);
	await send(env, MessageType.ProfileUpdate, { userId, action: 'restored' });
	return { job: await createJob(env, { kind: 'user.sync-holds', targetKind: 'user', targetId: userId, actorId }) };
}

/** Job user.delete-data: one budgeted erase step; an unfinished erase queues the next step with its resume token. */
async function runUserDelete(env: AdminServiceEnv, job: AdminJob): Promise<JobOutcome> {
	// Started only by the cleanup: a user restored meanwhile is not erased
	if (!(await pendingDeletion(env.SEARCH_DB!, 'user', job.targetId))) return { done: true, result: { skipped: 'user_not_deleted' } };
	const previous = (job.result?.deletedVideos as number | undefined) ?? 0;
	const summary = await eraseUserStep(env as AdminServiceEnv & Record<string, unknown>, job.targetId, job.params.resumeToken as string | undefined);
	const result = { deletedVideos: previous + summary.deletedVideoIds.length };
	if (!summary.complete) return { done: false, params: { resumeToken: summary.resumeToken }, result };
	return { done: true, result };
}

/** One step of a run account's cheap erasure (lib/privacy/run-user-erase.ts, #887). */
async function runRunUserErase(env: AdminServiceEnv, job: AdminJob): Promise<JobOutcome> {
	if (!(await pendingDeletion(env.SEARCH_DB!, 'user', job.targetId))) return { done: true, result: { skipped: 'user_not_deleted' } };
	const previous = (job.result?.deletedVideos as number | undefined) ?? 0;
	const step = await eraseRunUserData(
		env as never,
		job.targetId,
		new OperationBudget(900),
		{
			onVideoDeleted: async (videoId: string, video?: LibraryHints) => {
				// The video's own library (lib/bunny/libraries.ts)
				const b = await bunny(env, video);
				if (!b) return;
				try {
					await b.client.deleteVideo(b.libraryId, videoId);
				} catch (error) {
					logger.warn('[Admin] Bunny Stream delete failed', { videoId, error: error instanceof Error ? error.message : String(error) });
				}
			},
			// The user's Bunny collections go with the profile (lib/channelCollection.ts)
			onProfileDeleted: async (id: string, profile: unknown) => {
				await removeCollectionsFor(env as never, id, profile as never);
			},
		},
		Number(job.params.step) || 0,
	);
	for (const videoId of step.deletedVideoIds) await send(env, MessageType.VideoDelete, { videoId, userId: job.targetId, reason: 'admin-erasure' });
	const result = { deletedVideos: previous + step.deletedVideoIds.length };
	if (!step.complete) return { done: false, params: { step: step.step }, result };
	await send(env, MessageType.UserDataErased, { userId: job.targetId });
	return { done: true, result };
}

async function eraseUserStep(env: AdminServiceEnv & Record<string, unknown>, userId: string, resumeToken?: string) {
	const budget = new OperationBudget(900);
	const summary = await eraseUserData(
		env as never,
		userId,
		budget,
		{
			onVideoDeleted: async (videoId: string, video?: LibraryHints) => {
				// The video's own library (lib/bunny/libraries.ts)
				const b = await bunny(env, video);
				if (!b) return;
				try {
					await b.client.deleteVideo(b.libraryId, videoId);
				} catch (error) {
					logger.warn('[Admin] Bunny Stream delete failed', { videoId, error: error instanceof Error ? error.message : String(error) });
				}
			},
			// The user's Bunny collections go with the profile (lib/channelCollection.ts)
			onProfileDeleted: async (id: string, profile: unknown) => {
				await removeCollectionsFor(env as never, id, profile as never);
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

// ---------------------------------------------------------------------------
// Soft deletes: restore, "Delete permanently now", and the cleanup's purge
// ---------------------------------------------------------------------------

/** Restores a soft-deleted item (admin-api checks content:delete and audits it). */
export async function restoreDeletion(env: AdminServiceEnv, kind: AdminDeletionKind, id: string, actorId: string): Promise<{ restored: true; job?: AdminJob }> {
	switch (kind) {
		case 'channel':
			return { restored: true, ...(await restoreChannel(env, id, actorId)) };
		case 'video':
			await restoreVideo(env, id);
			return { restored: true };
		case 'comment':
			await restoreComment(env, id);
			return { restored: true };
		case 'playlist':
			await restorePlaylist(env, id);
			return { restored: true };
		case 'post':
			await restorePost(env, id);
			return { restored: true };
		case 'user':
			return { restored: true, ...(await restoreUser(env, id, actorId)) };
	}
}

/**
 * "Delete permanently now": queues the item for the next cleanup run, which
 * purges it the same way as one whose 30 days are up. It stays restorable
 * until that run starts the purge. admin-api checks content:purge and audits it.
 */
export async function requestDeletionPurge(env: AdminServiceEnv, kind: AdminDeletionKind, id: string, actorId: string): Promise<AdminDeletion> {
	const deletion = await pendingDeletion(env.SEARCH_DB!, kind, id);
	if (!deletion) throw new AdminError(404, 'deletion_not_found');
	if (!deletion.purgeRequestedAt) await requestPurge(env.SEARCH_DB!, kind, id, actorId);
	return (await pendingDeletion(env.SEARCH_DB!, kind, id)) ?? deletion;
}

const CLEANUP_ACTOR = 'system:deletion-cleanup';

/**
 * The one hard-delete path for admin deletes (run by the cleanup only,
 * lib/admin/deletions.ts runDeletionCleanup). Small items are erased here;
 * videos, channels and users through their admin job (R2, Bunny Stream,
 * search and ownership indexes, notifications). Every step is idempotent.
 */
export async function purgeDeletion(env: AdminServiceEnv, d: AdminDeletion): Promise<PurgeOutcome> {
	const actorId = d.purgeRequestedBy ?? CLEANUP_ACTOR;
	switch (d.kind) {
		case 'video': {
			const video = await repo(env.videos).getObject(d.id);
			if (!video) return { state: 'skipped', reason: 'video_gone' };
			if (video.isDeleted !== true) return { state: 'skipped', reason: 'video_not_deleted' };
			const job = await createJob(env, { kind: 'video.purge', targetKind: 'video', targetId: d.id, actorId, params: { userId: video.userId ?? null, channelId: video.channelId ?? null } });
			return { state: 'started', jobId: job.id };
		}
		case 'channel': {
			const channel = await repo(env.channels).getObject(d.id);
			if (!channel) return { state: 'skipped', reason: 'channel_gone' };
			if (channel.isDeleted !== true) return { state: 'skipped', reason: 'channel_not_deleted' };
			const job = await createJob(env, { kind: 'channel.purge', targetKind: 'channel', targetId: d.id, actorId, params: { userId: channel.userId ?? null } });
			return { state: 'started', jobId: job.id };
		}
		case 'user': {
			// E2E run accounts (the sweep's deletions) take the cheap, index-based erasure (#887)
			const kind = d.purgeRequestedBy === RUN_USER_SWEEP_ACTOR ? 'user.erase-run' : 'user.delete-data';
			const job = await createJob(env, { kind, targetKind: 'user', targetId: d.id, actorId });
			return { state: 'started', jobId: job.id };
		}
		case 'comment': {
			let removed = false;
			const video = await repo(env.videos).updateObject(d.parentId!, (fresh) => {
				const target = findStoredComment(fresh.comments as StoredComment[], d.id);
				if (!target || target.comment.isDeleted !== true) return false;
				fresh.comments = removeStoredComment(fresh.comments as StoredComment[], d.id).comments;
				removed = true;
				return true;
			});
			return removed ? { state: 'purged' } : { state: 'skipped', reason: video ? 'comment_gone' : 'video_gone' };
		}
		case 'playlist': {
			const playlist = await repo(env.playlists).getObject(d.id);
			if (!playlist) return { state: 'skipped', reason: 'playlist_gone' };
			if (playlist.isDeleted !== true) return { state: 'skipped', reason: 'playlist_not_deleted' };
			await env.playlists.delete(d.id);
			await send(env, MessageType.PlaylistDelete, { playlistId: d.id, userId: playlist.userId ?? d.ownerId ?? 'unknown', channelId: playlist.channelId, reason: 'admin' });
			return { state: 'purged' };
		}
		case 'post': {
			const key = postKey(d.parentId!, d.id);
			const post = await repo(env.community_posts).getObject(key);
			if (!post) return { state: 'skipped', reason: 'post_gone' };
			if (post.status !== 'deleted') return { state: 'skipped', reason: 'post_not_deleted' };
			await env.community_posts.delete(key);
			return { state: 'purged' };
		}
	}
}

/** Dry run of "Restore legacy profile fields" (lib/admin/legacy-restore.ts). */
export const legacyRestorePlan = (env: AdminServiceEnv) => planLegacyRestore(env);

/**
 * Queues "Restore legacy profile fields" for the approved items, narrowed to a
 * fresh plan (only fields that are still empty and planned).
 */
export async function startLegacyRestore(env: AdminServiceEnv, requested: ApprovedRestore[], actorId: string, runId?: string): Promise<{ job: AdminJob; approved: ApprovedRestore[] }> {
	const approved = approvedFromPlan(await planLegacyRestore(env), requested);
	if (!approved.length) throw new AdminError(409, 'nothing_to_restore', 'Nothing left to restore: the dry run has changed');
	const job = await createJob(env, { kind: 'profiles.restore-legacy', targetKind: LEGACY_RESTORE_TARGET.kind, targetId: LEGACY_RESTORE_TARGET.id, params: { approved, ...(runId ? { runId } : {}) }, actorId });
	return { job, approved };
}

/** The admin-jobs queue consumer's handlers, one per job kind (lib/admin/jobs.ts). */
export const ADMIN_JOB_HANDLERS: Record<AdminJobKind, JobHandler> = {
	'channel.sync-holds': (env, job) => syncChannelHolds(env as AdminServiceEnv, job),
	'channel.purge': (env, job) => purgeChannel(env as AdminServiceEnv, job),
	'channel.transfer': (env, job) => runTransfer(env as AdminServiceEnv, job),
	'video.move': (env, job) => runMove(env as AdminServiceEnv, job),
	'video.purge': (env, job) => runVideoPurge(env as AdminServiceEnv, job),
	'user.sync-holds': (env, job) => syncUserHolds(env as AdminServiceEnv, job),
	'user.delete-data': (env, job) => runUserDelete(env as AdminServiceEnv, job),
	'user.erase-run': (env, job) => runRunUserErase(env as AdminServiceEnv, job),
	'profiles.restore-legacy': (env, job) => runLegacyRestore(env as AdminServiceEnv, job),
	// Thumbnail aspect repair (lib/thumbnail/repair.ts), started from the admin Processing page
	'videos.repair-thumbnails': (env, job) => runThumbnailRepairStep(env as ThumbnailRepairEnv, job) as unknown as Promise<JobOutcome>,
	// Ownership index rebuild (lib/search/ownershipRebuild.ts), started from the Errors page's drift flag
	'search.rebuild-ownership': (env, job) => runOwnershipRebuildStep(env as OwnershipRebuildEnv, job),
	// Bulk adds to a channel playlist above the inline cap, or after an inline write failed (lib/playlistBulk.ts)
	'playlist.add-videos': (env, job) => runPlaylistAddStep(env as PlaylistEnv, job),
};

