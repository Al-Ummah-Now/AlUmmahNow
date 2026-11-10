/**
 * Channel playlist management: who may manage a playlist, and adding,
 * removing and reordering many videos at once.
 *
 *   request ≤ PLAYLIST_BULK_SYNC_MAX ids → validated and written inline
 *   more ids, or an inline write that failed → the rest runs as the admin
 *   job 'playlist.add-videos' (lib/admin/jobs.ts): queued, retried with
 *   backoff, dead-lettered, and a failure shows on the admin Errors page with
 *   Retry. The caller gets `queued` with the job id and polls it.
 *
 * Every write is a conditional read-modify-write on the playlist object
 * (R2Repository.updateObject), so two adds racing never lose each other.
 */
import {
	PLAYLIST_BULK_SYNC_MAX,
	PLAYLIST_MAX_VIDEOS,
	can,
	isShort,
	mergePlaylistOrder,
	playlistSortOf,
	type AdminJob,
	type PlaylistAddJobStatus,
	type PlaylistBulkAddResult,
	type PlaylistManageItem,
} from '@al-ummah/shared-types';
import R2Repository from './r2Repo';
import { createJob, getJob, retryJob, type JobEnv, type JobOutcome } from './admin/jobs';
import { canManagePlaylist, roleOnChannel, type ChannelAccessEnv } from './channelAccess';

/** Re-exported: the one manage check (lib/channelAccess.ts) every playlist write uses. */
export { canManagePlaylist };
import { isInternalRecord, isVideoPubliclyVisible } from './visibility';
import { orderedPlaylist, persistAutoOrder } from './playlistOrder';
import { logger } from './logger';
import type { PlaylistType, VideoType } from './playlists';

export const PLAYLIST_ADD_JOB_KIND = 'playlist.add-videos' as const;

/** Object reads run at once while validating ids. */
const READ_CONCURRENCY = 25;

export interface PlaylistEnv extends ChannelAccessEnv, JobEnv {
	playlists: R2Bucket;
	videos: R2Bucket;
}

/** Whether `userId` holds `playlist.manage` on `channelId`. */
export async function canManageChannelPlaylists(env: ChannelAccessEnv, channelId: string | null | undefined, userId: string | null | undefined): Promise<boolean> {
	if (!userId || !channelId) return false;
	try {
		return can(await roleOnChannel(env, channelId, userId), 'playlist.manage');
	} catch (error) {
		logger.warn('[PlaylistBulk] Channel read failed; access refused', { channelId, error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

/** A stored video that may go into a playlist of `channelId`. */
export function isChannelVideo(video: VideoType | null | undefined, channelId: string): video is VideoType {
	return !!video && !isInternalRecord(video) && video.channelId === channelId && video.isDeleted !== true && video.isHidden !== true;
}

async function loadInBatches<T>(ids: readonly string[], load: (id: string) => Promise<T | null>): Promise<(T | null)[]> {
	const out: (T | null)[] = [];
	for (let i = 0; i < ids.length; i += READ_CONCURRENCY) {
		out.push(...(await Promise.all(ids.slice(i, i + READ_CONCURRENCY).map((id) => load(id).catch(() => null)))));
	}
	return out;
}

/** The ids (in the given order) that are videos of `channelId`. Unreadable ids count as not in the channel. */
export async function channelVideoIdsOf(env: Pick<PlaylistEnv, 'videos'>, channelId: string, ids: readonly string[]): Promise<string[]> {
	const repo = new R2Repository<VideoType>(env.videos);
	const loaded = await loadInBatches(ids, (id) => repo.getObject(id));
	return ids.filter((_, i) => isChannelVideo(loaded[i], channelId));
}

export interface AddOutcome {
	added: number;
	alreadyInPlaylist: number;
	notInChannel: number;
	videosCount: number;
	/** The playlist is gone (deleted meanwhile). */
	missing?: boolean;
	/** Ids that did not fit under PLAYLIST_MAX_VIDEOS. */
	overLimit: number;
}

/**
 * Validates `ids` (videos of the playlist's channel) and appends the new ones
 * in the given order with one conditional write. Idempotent. At most
 * PLAYLIST_BULK_SYNC_MAX ids: callers chunk larger sets.
 */
export async function addVideosNow(env: PlaylistEnv, playlistId: string, channelId: string, ids: readonly string[]): Promise<AddOutcome> {
	if (ids.length > PLAYLIST_BULK_SYNC_MAX) throw new Error(`addVideosNow takes at most ${PLAYLIST_BULK_SYNC_MAX} ids`);
	const valid = await channelVideoIdsOf(env, channelId, ids);
	const notInChannel = ids.length - valid.length;
	const repo = new R2Repository<PlaylistType>(env.playlists);
	let added = 0;
	let already = 0;
	let overLimit = 0;
	const addedAt = new Date().toISOString();
	const stored = await repo.updateObject(playlistId, (fresh) => {
		added = 0;
		already = 0;
		overLimit = 0;
		const videos = fresh.videos || [];
		const present = new Set(videos);
		const next = [...videos];
		for (const id of valid) {
			if (present.has(id)) {
				already++;
				continue;
			}
			if (next.length >= PLAYLIST_MAX_VIDEOS) {
				overLimit++;
				continue;
			}
			present.add(id);
			next.push(id);
			added++;
		}
		if (added === 0) return false;
		// Manual order: new videos go to the end. Every add records its date
		// (the "date added" order); an automatic order re-sorts just below.
		const dates = { ...(fresh.videoAddedAt ?? {}) };
		for (const id of next.slice(videos.length)) dates[id] = addedAt;
		fresh.videos = next;
		fresh.videoAddedAt = dates;
		fresh.dateModified = addedAt;
		return true;
	});
	if (!stored) return { added: 0, alreadyInPlaylist: 0, notInChannel, videosCount: 0, missing: true, overLimit: 0 };
	if (added > 0) await persistAutoOrder(env, playlistId);
	return { added, alreadyInPlaylist: already, notInChannel, videosCount: (stored.videos || []).length, overLimit };
}

/** Parameters of a 'playlist.add-videos' job (one step handles PLAYLIST_BULK_SYNC_MAX ids). */
export interface PlaylistAddJobParams {
	playlistId: string;
	channelId: string;
	videoIds: string[];
	/** Ids before this offset are done. */
	offset: number;
	added: number;
	alreadyInPlaylist: number;
	notInChannel: number;
	overLimit: number;
}

/** Queues the add of `ids` as a job; never throws (a refused queue marks the job failed, which flags the admin). */
export async function queuePlaylistAdd(
	env: PlaylistEnv,
	input: { playlistId: string; channelId: string; ids: string[]; actorId: string },
): Promise<{ jobId: string; status: 'queued' | 'failed' }> {
	const params: PlaylistAddJobParams = {
		playlistId: input.playlistId,
		channelId: input.channelId,
		videoIds: input.ids,
		offset: 0,
		added: 0,
		alreadyInPlaylist: 0,
		notInChannel: 0,
		overLimit: 0,
	};
	const job = await createJob(env, {
		kind: PLAYLIST_ADD_JOB_KIND,
		targetKind: 'channel',
		targetId: input.channelId,
		params: params as unknown as Record<string, unknown>,
		actorId: input.actorId,
	});
	return { jobId: job.id, status: job.status === 'failed' ? 'failed' : 'queued' };
}

/**
 * Adds `ids` to the playlist: the first PLAYLIST_BULK_SYNC_MAX inline, the
 * rest (or everything, when the inline write fails) through the job queue.
 * Never fails silently: the answer says what was added and what is pending.
 */
export async function bulkAddVideos(
	env: PlaylistEnv,
	input: { playlist: PlaylistType; ids: string[]; actorId: string },
): Promise<PlaylistBulkAddResult> {
	const { playlist, ids, actorId } = input;
	const now = ids.slice(0, PLAYLIST_BULK_SYNC_MAX);
	const later = ids.slice(PLAYLIST_BULK_SYNC_MAX);
	let outcome: AddOutcome | null = null;
	let queueIds = later;
	try {
		outcome = await addVideosNow(env, playlist.id, playlist.channelId, now);
	} catch (error) {
		// The playlist stays as it is; the whole add finishes in the background
		logger.warn('[PlaylistBulk] Inline add failed; queueing it', { playlistId: playlist.id, count: ids.length, error: error instanceof Error ? error.message : String(error) });
		queueIds = ids;
	}
	const base = {
		added: outcome?.added ?? 0,
		alreadyInPlaylist: outcome?.alreadyInPlaylist ?? 0,
		notInChannel: outcome?.notInChannel ?? 0,
		videosCount: outcome?.videosCount ?? (playlist.videos || []).length,
	};
	if (queueIds.length === 0) return { status: 'done', ...base, pending: 0 };
	try {
		const queued = await queuePlaylistAdd(env, { playlistId: playlist.id, channelId: playlist.channelId, ids: queueIds, actorId });
		return { status: queued.status, ...base, pending: queueIds.length, jobId: queued.jobId };
	} catch (error) {
		// Could not even record the job: flag it for the admin (logs → Errors page); the caller offers Retry
		logger.error('[PlaylistBulk] Could not queue the add', { alert: 'admin_job_failed', playlistId: playlist.id, pending: queueIds.length, error: error instanceof Error ? error.message : String(error) });
		return { status: 'failed', ...base, pending: queueIds.length };
	}
}

/** One step of a 'playlist.add-videos' job: the next PLAYLIST_BULK_SYNC_MAX ids. Throws to retry. */
export async function runPlaylistAddStep(env: PlaylistEnv, job: AdminJob): Promise<JobOutcome> {
	const params = job.params as unknown as PlaylistAddJobParams;
	if (!params?.playlistId || !params.channelId || !Array.isArray(params.videoIds)) {
		throw new Error('playlist.add-videos: missing playlistId, channelId or videoIds');
	}
	const offset = Math.max(0, Number(params.offset) || 0);
	const chunk = params.videoIds.slice(offset, offset + PLAYLIST_BULK_SYNC_MAX);
	const outcome = await addVideosNow(env, params.playlistId, params.channelId, chunk);
	const next: PlaylistAddJobParams = {
		...params,
		offset: offset + chunk.length,
		added: (params.added || 0) + outcome.added,
		alreadyInPlaylist: (params.alreadyInPlaylist || 0) + outcome.alreadyInPlaylist,
		notInChannel: (params.notInChannel || 0) + outcome.notInChannel,
		overLimit: (params.overLimit || 0) + outcome.overLimit,
	};
	const result = {
		total: params.videoIds.length,
		processed: next.offset,
		added: next.added,
		alreadyInPlaylist: next.alreadyInPlaylist,
		notInChannel: next.notInChannel,
		overLimit: next.overLimit,
		...(outcome.missing ? { playlistMissing: true } : {}),
	};
	if (outcome.missing) {
		logger.info('[PlaylistBulk] Playlist gone; add job ends', { jobId: job.id, playlistId: params.playlistId });
		return { done: true, result };
	}
	if (next.offset >= params.videoIds.length) return { done: true, result };
	return { done: false, params: next as unknown as Record<string, unknown>, result };
}

/** The job as the playlist's managers see it, or null when it is not this playlist's add job. */
export function toPlaylistJobStatus(job: AdminJob | null, playlistId: string): PlaylistAddJobStatus | null {
	if (!job || job.kind !== PLAYLIST_ADD_JOB_KIND) return null;
	const params = job.params as unknown as Partial<PlaylistAddJobParams>;
	if (params.playlistId !== playlistId) return null;
	const result = (job.result ?? {}) as Partial<Record<'processed' | 'added' | 'notInChannel', number>>;
	return {
		id: job.id,
		playlistId,
		status: job.status,
		total: Array.isArray(params.videoIds) ? params.videoIds.length : 0,
		processed: Number(result.processed ?? params.offset ?? 0) || 0,
		added: Number(result.added ?? params.added ?? 0) || 0,
		notInChannel: Number(result.notInChannel ?? params.notInChannel ?? 0) || 0,
		updatedAt: job.updatedAt,
	};
}

export async function playlistJobStatus(env: JobEnv, jobId: string, playlistId: string): Promise<PlaylistAddJobStatus | null> {
	return toPlaylistJobStatus(await getJob(env, jobId), playlistId);
}

/** Queues a failed add job of this playlist again (fresh retry budget). */
export async function retryPlaylistJob(env: JobEnv, jobId: string, playlistId: string): Promise<PlaylistAddJobStatus | null> {
	const current = await playlistJobStatus(env, jobId, playlistId);
	if (!current) return null;
	if (current.status !== 'failed') return current;
	return toPlaylistJobStatus(await retryJob(env, jobId), playlistId);
}

/** Removes `ids` with one conditional write. Idempotent: ids not in the playlist are ignored. */
export async function removeVideos(env: Pick<PlaylistEnv, 'playlists'>, playlistId: string, ids: readonly string[]): Promise<{ removed: number; videosCount: number; missing?: boolean }> {
	const drop = new Set(ids);
	let removed = 0;
	const stored = await new R2Repository<PlaylistType>(env.playlists).updateObject(playlistId, (fresh) => {
		const videos = fresh.videos || [];
		const kept = videos.filter((id) => !drop.has(id));
		removed = videos.length - kept.length;
		if (removed === 0) return false;
		fresh.videos = kept;
		if (fresh.videoAddedAt) {
			const dates = { ...fresh.videoAddedAt };
			for (const id of drop) delete dates[id];
			fresh.videoAddedAt = dates;
		}
		fresh.dateModified = new Date().toISOString();
		return true;
	});
	if (!stored) return { removed: 0, videosCount: 0, missing: true };
	return { removed, videosCount: (stored.videos || []).length };
}

/**
 * Applies a new manual order with the merge rule (shared-types
 * mergePlaylistOrder), so concurrent adds and removes survive. A playlist in
 * automatic order is not reordered by hand (`automatic`).
 */
export async function reorderVideos(env: Pick<PlaylistEnv, 'playlists'>, playlistId: string, requested: readonly string[]): Promise<{ videos: string[]; missing?: boolean; automatic?: boolean }> {
	let automatic = false;
	const stored = await new R2Repository<PlaylistType>(env.playlists).updateObject(playlistId, (fresh) => {
		automatic = playlistSortOf(fresh).sortMode === 'auto';
		if (automatic) return false;
		const current = fresh.videos || [];
		const next = mergePlaylistOrder(current, requested);
		if (next.length === current.length && next.every((id, i) => id === current[i])) return false;
		fresh.videos = next;
		fresh.dateModified = new Date().toISOString();
		return true;
	});
	if (!stored) return { videos: [], missing: true };
	if (automatic) return { videos: stored.videos || [], automatic: true };
	return { videos: stored.videos || [] };
}

/** One page of the playlist's entries for its managers: every stored id, with its video or null when unavailable. */
export async function playlistManageItems(env: Pick<PlaylistEnv, 'videos'>, playlist: PlaylistType, offset: number, limit: number): Promise<{ items: PlaylistManageItem[]; order: string[]; known: Map<string, VideoType> }> {
	// Sorted before the page is cut, so pages never overlap or skip
	const ordered = await orderedPlaylist(env, playlist);
	const ids = ordered.ids.slice(offset, offset + limit);
	const repo = new R2Repository<VideoType>(env.videos);
	const loaded = await loadInBatches(ids, (id) => ordered.videos.has(id) ? Promise.resolve(ordered.videos.get(id)!) : repo.getObject(id));
	const items = ids.map((id, i) => {
		const video = loaded[i];
		// The channel's own videos show in full (managers see its private and
		// processing ones); another channel's video (saved from its watch page)
		// only while it is public, so no private metadata leaks
		const usable = !!video && !isInternalRecord(video) && video.isDeleted !== true && video.isHidden !== true
			&& (video.channelId === playlist.channelId || isVideoPubliclyVisible(video));
		return {
			id,
			position: offset + i,
			video: usable ? {
				id: video.id,
				title: video.title,
				...(video.titleLocalized ? { titleLocalized: video.titleLocalized as Record<string, string> } : {}),
				...(video.thumbnailUrl ? { thumbnailUrl: video.thumbnailUrl } : {}),
				...(typeof video.duration === 'number' ? { duration: video.duration } : {}),
				isPublic: video.isPublic !== false,
				isShort: isShort(video as never),
				...(typeof video.width === 'number' ? { width: video.width } : {}),
				...(typeof video.height === 'number' ? { height: video.height } : {}),
				...(video.channelId ? { channelId: video.channelId } : {}),
				...(video.uploadStatus ? { uploadStatus: video.uploadStatus } : {}),
			} : null,
		};
	});
	return { items, order: ordered.ids, known: ordered.videos };
}
