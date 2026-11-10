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
	LEGACY_RESTORE_TARGET,
	liftSuspensionHold,
	userHold,
	type AdminChannelDetail,
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
import Queue, { MessageType } from '../queue';
import { claimHandle, handleKey, normalizeHandleInput, releaseHandle, releaseReplacedHandle } from '../channelHandles';
import { pickNewMainChannel, removeChannelPostsAndSections, softDeleteChannelObjectsStep, type OwnedChannelSummary } from '../channelDeletion';
import { findStoredComment, removeStoredComment, type StoredComment } from '../comments';
import { subscriberCounts, subscribedChannelIds } from '../subscription-store';
import { eraseUserData } from '../privacy/user-data';
import { OperationBudget } from '../privacy/scan';
import { BunnyStreamClient } from '../bunny/stream';
import { requireSecret } from '../env-helpers';
import { readAssignment } from '../creatorTiers';
import { bansFor, deleteBan, readBan, writeBan } from './bans';
import { createJob, type JobHandler, type JobOutcome, type JobQueue } from './jobs';
import { approvedFromPlan, planLegacyRestore, runLegacyRestore, type ApprovedRestore, type AuthUsersDb } from './legacy-restore';
import { runThumbnailRepairStep, type ThumbnailRepairEnv } from '../thumbnail/repair';
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
	/** The admin-jobs queue (heavy actions run from it; lib/admin/jobs.ts). */
	ADMIN_JOBS_QUEUE?: JobQueue;
	/** Auth service D1, read only (verified emails for the legacy profile restore). */
	AUTH_DB?: AuthUsersDb;
	/** Private bucket for pre-change copies written by admin jobs. */
	ADMIN_BACKUPS?: R2Bucket;
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
	const suspended = channel.isSuspended === true && channel.isDeleted !== true;
	const mutate = (r: Row) => (suspended ? applySuspensionHold(r as SuspendableRecord, hold) : liftSuspensionHold(r as SuspendableRecord, hold));
	const videos = await cascade(env.videos, await idsOf(env, 'video', { channelId: id }), mutate);
	const live = await cascadeLiveStreams(env, { channelId: id }, mutate);
	return finish({ suspended, videos: videos.changed, liveStreams: live.changed }, videos.failed + live.failed);
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
	if (!target) throw new AdminError(404, 'new_owner_not_found');
	if (env.SEARCH_DB && (await readBan(env.SEARCH_DB, newOwnerId))) throw new AdminError(409, 'new_owner_banned');
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
	await env.videos.delete(videoId);
	const b = bunnyClient === undefined ? await bunny(env) : bunnyClient;
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

/**
 * Soft-deletes a channel: at once the record is marked deleted and hidden (it
 * stays for the audit trail), its handle is freed and it leaves its owner's
 * profile; a job then erases its videos (R2, Bunny, search, notifications) and
 * removes its playlists, posts and sections.
 */
export async function deleteChannel(env: AdminServiceEnv, id: string, actorId: string): Promise<{ job: AdminJob }> {
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
	return { job: await createJob(env, { kind: 'channel.purge', targetKind: 'channel', targetId: id, actorId, params: { userId: channel.userId ?? null } }) };
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
		const videoIds = await idsOf(env, 'video', { channelId: id });
		const b = await bunny(env);
		let failed = 0;
		await eachLimited(videoIds, 6, async (videoId) => {
			try {
				await purgeVideo(env, videoId, { userId, channelId: id }, b);
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
	const step = await softDeleteChannelObjectsStep(env.playlists, id, { cursor: p.cursor as string | undefined, budget: PLAYLIST_SCAN_STEP });
	// A failed write retries this step (from its own cursor), never skips it
	if (step.failed > 0) return finish({ playlists: p.playlists, cursor: p.cursor ?? null }, step.failed);
	const result = { videos: p.videos, posts: p.posts, sections: p.sections, playlists: Number(p.playlists ?? 0) + step.removed, scanned: Number(p.scanned ?? 0) + step.scanned };
	if (step.cursor) return { done: false, params: { ...p, ...result, cursor: step.cursor }, result };
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

/** Deletes a video: hidden and marked deleted at once; a job erases it (R2, Bunny, search, notifications). */
export async function deleteVideo(env: AdminServiceEnv, id: string, actorId: string): Promise<{ job: AdminJob }> {
	if (id.includes(':')) throw new AdminError(404, 'video_not_found');
	const saved = await repo(env.videos).updateObject(id, (fresh) => {
		if (fresh.isDeleted === true && fresh.isHidden === true) return false;
		fresh.isDeleted = true;
		fresh.isHidden = true;
		fresh.deletedAt = now();
		fresh.dateModified = now();
		return true;
	});
	if (!saved) throw new AdminError(404, 'video_not_found');
	return { job: await createJob(env, { kind: 'video.purge', targetKind: 'video', targetId: id, actorId, params: { userId: saved.userId ?? null, channelId: saved.channelId ?? null } }) };
}

/** Job video.purge. Idempotent: an erased video is simply gone. */
async function runVideoPurge(env: AdminServiceEnv, job: AdminJob): Promise<JobOutcome> {
	await purgeVideo(env, job.targetId, { userId: job.params.userId, channelId: job.params.channelId }, undefined, { strict: true });
	return { done: true };
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
	const hold = userHold(userId);
	const mutate = (r: Row) => (banned ? applySuspensionHold(r as SuspendableRecord, hold) : liftSuspensionHold(r as SuspendableRecord, hold));
	const channels = await cascade(env.channels, await idsOf(env, 'channel', { ownerId: userId }), mutate);
	const videos = await cascade(env.videos, await idsOf(env, 'video', { ownerId: userId }), mutate);
	const live = await cascadeLiveStreams(env, { ownerId: userId }, mutate);
	return finish({ banned, channels: channels.changed, videos: videos.changed, liveStreams: live.changed }, channels.failed + videos.failed + live.failed);
}

/**
 * Erases the user's videos data (profile, channels, videos and their media,
 * playlists, history, comments, likes, subscriptions) with the privacy-erase
 * path, as a job (user.delete-data) that runs in resumable steps. A ban, if
 * any, is kept. Auth is not involved: their account and sign-in keep working,
 * and signing in to videos again starts a new, empty profile (unless banned).
 */
export async function deleteUserData(env: AdminServiceEnv, userId: string, actorId: string): Promise<{ job: AdminJob }> {
	return { job: await createJob(env, { kind: 'user.delete-data', targetKind: 'user', targetId: userId, actorId }) };
}

/** Job user.delete-data: one budgeted erase step; an unfinished erase queues the next step with its resume token. */
async function runUserDelete(env: AdminServiceEnv, job: AdminJob): Promise<JobOutcome> {
	const previous = (job.result?.deletedVideos as number | undefined) ?? 0;
	const summary = await eraseUserStep(env as AdminServiceEnv & Record<string, unknown>, job.targetId, job.params.resumeToken as string | undefined);
	const result = { deletedVideos: previous + summary.deletedVideoIds.length };
	if (!summary.complete) return { done: false, params: { resumeToken: summary.resumeToken }, result };
	return { done: true, result };
}

async function eraseUserStep(env: AdminServiceEnv & Record<string, unknown>, userId: string, resumeToken?: string) {
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
	'profiles.restore-legacy': (env, job) => runLegacyRestore(env as AdminServiceEnv, job),
	// Thumbnail aspect repair (lib/thumbnail/repair.ts), started from the admin Processing page
	'videos.repair-thumbnails': (env, job) => runThumbnailRepairStep(env as ThumbnailRepairEnv, job) as unknown as Promise<JobOutcome>,
};
