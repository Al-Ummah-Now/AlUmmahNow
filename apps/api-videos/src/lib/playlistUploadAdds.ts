/**
 * Playlist adds for new uploads (owner, 2026-11-10: "in batch upload we need
 * playlist add/create, and in single upload as well").
 *
 * The upload page picks playlists for a video (single upload) or for every
 * video of a batch (with a per-video override). As soon as the video record
 * exists (upload initiate returned its id) the page asks for the adds:
 *
 *   POST /api/playlists/upload-adds → checks → one record + one queued message per video→playlist
 *   consumer → add (idempotent, upload order kept) → record "added"
 *   failure → retry with backoff → last delivery: record "failed", flagged on
 *   the admin Errors page with Retry (POST /internal/playlist-adds/retry), and
 *   the queue dead-letters the message
 *
 * Messages ride the processing-check queue (kind `playlist-add`, like the
 * upload reaper), so they share its retries and DLQ and need no new queue.
 *
 * Idempotent: a video already in the playlist is never added twice; the
 * record holds the active loop id and a message of an older loop is dropped.
 * Upload order: each add carries an order key (batch id + position); the
 * video is placed after the batch's earlier videos already in the playlist and
 * before its later ones, whatever order the messages arrive in.
 *
 * Who may add: the playlist's owner, or a role on the playlist's channel that
 * grants `playlist.manage` (owner, admin, editor), checked on request and
 * again when the add runs. The upload itself never fails because of an add.
 */

import { reportNeedsAction, resolveNeedsAction, type ErrorReporterEnv, type ExecutionContextLike } from '@al-ummah/shared-types';
import { logger } from './logger';
import R2Repository from './r2Repo';
import { canManagePlaylist, type ChannelAccessEnv } from './channelAccess';
import type { PlaylistType } from './playlists';

export const PLAYLIST_ADD_KIND = 'playlist-add';
export const PLAYLIST_ADD_PREFIX = 'ops/playlist-adds/';
/** Queue deliveries of one message: 1 + max_retries (wrangler: 5). */
export const PLAYLIST_ADD_MAX_DELIVERIES = 6;
/** Playlists one request may add a video to. */
export const MAX_PLAYLISTS_PER_VIDEO = 20;
/** Videos one status read may ask about (a batch holds at most 15). */
export const MAX_STATUS_VIDEOS = 50;

export type PlaylistAddStatus = 'pending' | 'added' | 'retrying' | 'failed';
/** Why an add will not happen (no retry): shown to the uploader as "not added". */
export type PlaylistAddRefusal = 'playlist_not_found' | 'other_channel' | 'forbidden' | 'video_gone';

export interface PlaylistAddRecord {
	videoId: string;
	playlistId: string;
	channelId: string;
	/** Who asked (the uploader); the add runs with their rights. */
	requestedBy: string;
	/** Position in the upload (batch id + zero-padded index); orders the batch's videos. */
	orderKey: string;
	status: PlaylistAddStatus;
	/** Active loop: a message of any other loop is dropped. */
	loopId: string;
	attempts: number;
	lastError?: string;
	/** Set when the add will not happen. */
	refusal?: PlaylistAddRefusal;
	/** Flagged on the admin Errors page (resolved there once the add works). */
	flagged?: boolean;
	createdAt: string;
	updatedAt: string;
	addedAt?: string;
}

export interface PlaylistAddMessage {
	kind: typeof PLAYLIST_ADD_KIND;
	videoId: string;
	playlistId: string;
	loopId: string;
}

export interface PlaylistAddEnv extends ChannelAccessEnv, ErrorReporterEnv {
	videos: R2Bucket;
	playlists: R2Bucket;
	channels: R2Bucket;
	global_settings: R2Bucket;
	PROCESSING_CHECK_QUEUE?: Queue;
}

/** Playlist record with the upload order of videos added by this flow. */
type OrderedPlaylist = PlaylistType & { uploadOrder?: Record<string, string> };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ORDER_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,96}$/;

export function recordKey(videoId: string, playlistId: string): string {
	return `${PLAYLIST_ADD_PREFIX}${videoId}/${playlistId}.json`;
}

export function needsActionKey(videoId: string, playlistId: string): string {
	return `playlist-add:${videoId}:${playlistId}`;
}

export function isValidId(id: unknown): id is string {
	return typeof id === 'string' && ID_PATTERN.test(id);
}

export function isValidOrderKey(key: unknown): key is string {
	return typeof key === 'string' && ORDER_KEY_PATTERN.test(key);
}

export function isPlaylistAddMessage(body: unknown): body is PlaylistAddMessage {
	return !!body && typeof body === 'object' && (body as { kind?: unknown }).kind === PLAYLIST_ADD_KIND;
}

/** Backoff between deliveries of a failing add: 30 s, 2 m, 8 m, 32 m, then hourly. */
export function playlistAddRetryDelaySeconds(attempts: number): number {
	return Math.min(3600, 30 * 4 ** Math.max(0, attempts - 1));
}

function records(env: Pick<PlaylistAddEnv, 'global_settings'>) {
	return new R2Repository<PlaylistAddRecord>(env.global_settings);
}

async function readRecord(env: Pick<PlaylistAddEnv, 'global_settings'>, videoId: string, playlistId: string): Promise<PlaylistAddRecord | null> {
	return records(env).getObject(recordKey(videoId, playlistId));
}

/**
 * Where a video with `orderKey` goes in `videos` so the videos of one upload
 * batch keep their upload order: right after the last video of the same batch
 * that comes before it, else right before the first one that comes after it,
 * else at the end. Videos without a key (added by hand) are never reordered.
 */
export function insertionIndex(videos: readonly string[], order: Readonly<Record<string, string>>, orderKey: string): number {
	const batch = orderKey.slice(0, orderKey.lastIndexOf(':') + 1);
	let after = -1;
	let before = -1;
	videos.forEach((id, index) => {
		const key = order[id];
		if (!key || !batch || !key.startsWith(batch)) return;
		if (key < orderKey) after = index;
		else if (before === -1) before = index;
	});
	if (after !== -1) return after + 1;
	if (before !== -1) return before;
	return videos.length;
}

/** Order key of the `index`-th video of upload batch `batchId` (sorts as a string). */
export function orderKeyFor(batchId: string, index: number): string {
	return `${batchId}:${String(Math.max(0, Math.floor(index))).padStart(6, '0')}`;
}

/**
 * Adds the video on the fresh playlist (conditional write). Idempotent: a
 * video already there is left where it is. Order keys of videos no longer in
 * the playlist are dropped, so the map never outgrows the playlist.
 */
export async function addVideoInOrder(env: Pick<PlaylistAddEnv, 'playlists'>, playlistId: string, videoId: string, orderKey: string, guard: (fresh: OrderedPlaylist) => boolean): Promise<'added' | 'already' | 'missing' | 'refused'> {
	let outcome: 'added' | 'already' | 'refused' = 'added';
	const stored = await new R2Repository<OrderedPlaylist>(env.playlists).updateObject(playlistId, (fresh) => {
		outcome = 'added';
		if (fresh.isDeleted || !guard(fresh)) {
			outcome = 'refused';
			return false;
		}
		const videos = fresh.videos || [];
		if (videos.includes(videoId)) {
			outcome = 'already';
			return false;
		}
		const order: Record<string, string> = {};
		for (const [id, key] of Object.entries(fresh.uploadOrder || {})) if (videos.includes(id)) order[id] = key;
		const at = insertionIndex(videos, order, orderKey);
		fresh.videos = [...videos.slice(0, at), videoId, ...videos.slice(at)];
		order[videoId] = orderKey;
		fresh.uploadOrder = order;
		fresh.dateModified = new Date().toISOString();
		return true;
	});
	return stored ? outcome : 'missing';
}

export interface AddRequest {
	videoId: string;
	channelId: string;
	userId: string;
	playlistIds: string[];
	orderKey: string;
}

export interface AddRequestItem {
	playlistId: string;
	status: PlaylistAddStatus;
	refusal?: PlaylistAddRefusal;
}

export type AddRequestResult =
	| { ok: true; items: AddRequestItem[] }
	| { ok: false; status: 400 | 403 | 404; error: string };

/**
 * Checks a request and queues one add per playlist. A playlist the caller may
 * not use is answered "failed" with the reason and never queued; the others
 * are "pending" (or "added" when they already were).
 */
export async function requestPlaylistAdds(env: PlaylistAddEnv, req: AddRequest, ctx?: ExecutionContextLike, now = new Date()): Promise<AddRequestResult> {
	const playlistIds = [...new Set(req.playlistIds)];
	if (!isValidId(req.videoId) || playlistIds.length === 0 || playlistIds.length > MAX_PLAYLISTS_PER_VIDEO || !playlistIds.every(isValidId) || !isValidOrderKey(req.orderKey)) {
		return { ok: false, status: 400, error: 'Invalid playlist add request' };
	}
	const video = await new R2Repository<{ id: string; channelId?: string; userId?: string; isDeleted?: boolean }>(env.videos).getObject(req.videoId);
	if (!video || video.isDeleted) return { ok: false, status: 404, error: 'Video not found' };
	// Only the video's own channel, acting through the channel the request is made as
	if (!video.channelId || video.channelId !== req.channelId) return { ok: false, status: 403, error: 'The video belongs to another channel' };

	const playlistRepo = new R2Repository<PlaylistType>(env.playlists);
	const items: AddRequestItem[] = [];
	const toQueue: PlaylistAddMessage[] = [];
	for (const playlistId of playlistIds) {
		const playlist = await playlistRepo.getObject(playlistId);
		let refusal: PlaylistAddRefusal | undefined;
		if (!playlist || playlist.isDeleted) refusal = 'playlist_not_found';
		else if (playlist.channelId !== video.channelId) refusal = 'other_channel';
		else if (!(await canManagePlaylist(env, playlist, req.userId))) refusal = 'forbidden';
		if (refusal) {
			logger.warn('[PlaylistAdds] Add refused', { videoId: req.videoId, playlistId, refusal });
			items.push({ playlistId, status: 'failed', refusal });
			continue;
		}
		if ((playlist!.videos || []).includes(req.videoId)) {
			items.push({ playlistId, status: 'added' });
			continue;
		}
		const loopId = crypto.randomUUID();
		const at = now.toISOString();
		const stored = await records(env).updateObject(recordKey(req.videoId, playlistId), (fresh) => {
			// Already added (a retried request): nothing to queue
			if (fresh.status === 'added') return false;
			Object.assign(fresh, {
				channelId: video.channelId!,
				requestedBy: req.userId,
				orderKey: req.orderKey,
				status: 'pending',
				loopId,
				attempts: 0,
				updatedAt: at,
			} satisfies Partial<PlaylistAddRecord>);
			delete fresh.lastError;
			delete fresh.refusal;
			return true;
		}, {
			initial: () => ({ videoId: req.videoId, playlistId, channelId: video.channelId!, requestedBy: req.userId, orderKey: req.orderKey, status: 'pending', loopId, attempts: 0, createdAt: at, updatedAt: at }),
		});
		if (stored?.status === 'added') {
			items.push({ playlistId, status: 'added' });
			continue;
		}
		items.push({ playlistId, status: 'pending' });
		toQueue.push({ kind: PLAYLIST_ADD_KIND, videoId: req.videoId, playlistId, loopId });
	}

	for (const message of toQueue) await enqueue(env, message, ctx);
	logger.info('[PlaylistAdds] Adds requested', { videoId: req.videoId, queued: toQueue.length, total: items.length });
	return { ok: true, items };
}

/** Queues one add; when the queue cannot take it, the add is flagged for an admin (Retry). */
async function enqueue(env: PlaylistAddEnv, message: PlaylistAddMessage, ctx?: ExecutionContextLike): Promise<void> {
	try {
		if (!env.PROCESSING_CHECK_QUEUE) throw new Error('PROCESSING_CHECK_QUEUE not bound');
		await env.PROCESSING_CHECK_QUEUE.send(message);
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		logger.error('[PlaylistAdds] Could not queue the add', { videoId: message.videoId, playlistId: message.playlistId, error: text });
		await markFailed(env, message, `Not queued: ${text}`, ctx);
	}
}

/** The record of a failed add, flagged on the admin Errors page with Retry. */
async function markFailed(env: PlaylistAddEnv, message: Pick<PlaylistAddMessage, 'videoId' | 'playlistId' | 'loopId'>, error: string, ctx?: ExecutionContextLike, attempts?: number): Promise<void> {
	try {
		await records(env).updateObject(recordKey(message.videoId, message.playlistId), (fresh) => {
			if (fresh.loopId !== message.loopId || fresh.status === 'added') return false;
			fresh.status = 'failed';
			fresh.lastError = error.slice(0, 500);
			fresh.flagged = true;
			if (attempts !== undefined) fresh.attempts = attempts;
			fresh.updatedAt = new Date().toISOString();
			return true;
		});
	} catch (recordError) {
		logger.error('[PlaylistAdds] Could not record the failure', { videoId: message.videoId, playlistId: message.playlistId, error: recordError instanceof Error ? recordError.message : String(recordError) });
	}
	reportNeedsAction('api-videos', env, ctx, {
		key: needsActionKey(message.videoId, message.playlistId),
		source: 'queue',
		title: 'Upload not added to its playlist',
		message: error.slice(0, 500),
		itemType: 'playlist-add',
		itemId: `${message.videoId}:${message.playlistId}`,
		retry: { kind: 'service', service: 'api-videos', path: '/internal/playlist-adds/retry', body: { videoId: message.videoId, playlistId: message.playlistId } },
		retryLabel: 'Add again',
		extra: { videoId: message.videoId, playlistId: message.playlistId },
	});
}

/** Marks a record that will not be added (no retry, not an admin item). */
async function markRefused(env: PlaylistAddEnv, message: PlaylistAddMessage, refusal: PlaylistAddRefusal): Promise<void> {
	await records(env).updateObject(recordKey(message.videoId, message.playlistId), (fresh) => {
		if (fresh.loopId !== message.loopId) return false;
		fresh.status = 'failed';
		fresh.refusal = refusal;
		fresh.updatedAt = new Date().toISOString();
		return true;
	});
}

export type AddRunOutcome = 'added' | 'already' | 'superseded' | PlaylistAddRefusal;

/** One add, run by the queue consumer. Throws on a failure worth retrying. */
export async function runPlaylistAdd(env: PlaylistAddEnv, message: PlaylistAddMessage, ctx?: ExecutionContextLike): Promise<AddRunOutcome> {
	const record = await readRecord(env, message.videoId, message.playlistId);
	if (!record || record.loopId !== message.loopId) return 'superseded';
	if (record.status === 'added') return 'already';

	const playlist = await new R2Repository<PlaylistType>(env.playlists).getObject(message.playlistId);
	if (!playlist || playlist.isDeleted) {
		await markRefused(env, message, 'playlist_not_found');
		return 'playlist_not_found';
	}
	if (playlist.channelId !== record.channelId) {
		await markRefused(env, message, 'other_channel');
		return 'other_channel';
	}
	// Checked again: the uploader's role may have changed since the request
	if (!(await canManagePlaylist(env, playlist, record.requestedBy))) {
		await markRefused(env, message, 'forbidden');
		return 'forbidden';
	}
	const video = await new R2Repository<{ id: string; channelId?: string; isDeleted?: boolean }>(env.videos).getObject(message.videoId);
	if (!video) throw new Error('Video record not found yet');
	if (video.isDeleted) {
		await markRefused(env, message, 'video_gone');
		return 'video_gone';
	}

	const result = await addVideoInOrder(env, message.playlistId, message.videoId, record.orderKey, (fresh) => fresh.channelId === record.channelId);
	if (result === 'missing' || result === 'refused') {
		await markRefused(env, message, 'playlist_not_found');
		return 'playlist_not_found';
	}

	const at = new Date().toISOString();
	await records(env).updateObject(recordKey(message.videoId, message.playlistId), (fresh) => {
		if (fresh.loopId !== message.loopId) return false;
		fresh.status = 'added';
		fresh.addedAt = at;
		fresh.updatedAt = at;
		delete fresh.lastError;
		return true;
	});
	// An admin's Retry (or a later delivery) fixed a flagged add: the Errors item resolves
	if (record.flagged) resolveNeedsAction(env, ctx, needsActionKey(message.videoId, message.playlistId));
	logger.info('[PlaylistAdds] Video added to playlist', { videoId: message.videoId, playlistId: message.playlistId, result });
	return result;
}

interface QueueMessageLike<T> {
	body: T;
	attempts: number;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

/** Queue consumer for playlist-add messages (dispatched from the processing-check queue). */
export async function handlePlaylistAddBatch(batch: { messages: readonly QueueMessageLike<unknown>[] }, env: PlaylistAddEnv, ctx?: ExecutionContextLike): Promise<void> {
	for (const msg of batch.messages) {
		const body = msg.body as PlaylistAddMessage;
		if (!isPlaylistAddMessage(body) || !isValidId(body.videoId) || !isValidId(body.playlistId) || typeof body.loopId !== 'string') {
			logger.error('[PlaylistAdds] Malformed message dropped', { body });
			msg.ack();
			continue;
		}
		try {
			await runPlaylistAdd(env, body, ctx);
			msg.ack();
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			const last = msg.attempts >= PLAYLIST_ADD_MAX_DELIVERIES;
			if (last) {
				// Flagged for an admin (Errors page, Retry); the queue dead-letters the message
				await markFailed(env, body, text, ctx, msg.attempts);
			} else {
				try {
					await records(env).updateObject(recordKey(body.videoId, body.playlistId), (fresh) => {
						if (fresh.loopId !== body.loopId || fresh.status === 'added') return false;
						fresh.status = 'retrying';
						fresh.attempts = msg.attempts;
						fresh.lastError = text.slice(0, 500);
						fresh.updatedAt = new Date().toISOString();
						return true;
					});
				} catch (recordError) {
					logger.error('[PlaylistAdds] Could not record the retry', { videoId: body.videoId, playlistId: body.playlistId, error: recordError instanceof Error ? recordError.message : String(recordError) });
				}
			}
			const delaySeconds = playlistAddRetryDelaySeconds(msg.attempts);
			logger[last ? 'error' : 'warn']('[PlaylistAdds] Add failed', { videoId: body.videoId, playlistId: body.playlistId, attempts: msg.attempts, last, delaySeconds, error: text });
			msg.retry({ delaySeconds });
		}
	}
}

/**
 * Admin Retry (Errors page → admin-api → POST /internal/playlist-adds/retry):
 * starts a new loop for a failed add. null when there is no such add.
 */
export async function retryPlaylistAdd(env: PlaylistAddEnv, videoId: string, playlistId: string, ctx?: ExecutionContextLike): Promise<PlaylistAddStatus | null> {
	if (!isValidId(videoId) || !isValidId(playlistId)) return null;
	const loopId = crypto.randomUUID();
	const stored = await records(env).updateObject(recordKey(videoId, playlistId), (fresh) => {
		if (fresh.status === 'added') return false;
		fresh.status = 'pending';
		fresh.loopId = loopId;
		fresh.attempts = 0;
		delete fresh.refusal;
		fresh.updatedAt = new Date().toISOString();
		return true;
	});
	if (!stored) return null;
	if (stored.status === 'added') {
		resolveNeedsAction(env, ctx, needsActionKey(videoId, playlistId));
		return 'added';
	}
	await enqueue(env, { kind: PLAYLIST_ADD_KIND, videoId, playlistId, loopId }, ctx);
	logger.info('[PlaylistAdds] Add retried', { videoId, playlistId });
	return 'pending';
}

export interface AddStatusItem {
	videoId: string;
	playlistId: string;
	status: PlaylistAddStatus;
	refusal?: PlaylistAddRefusal;
	attempts: number;
}

/** The adds the caller requested for these videos (the upload page's notice). */
export async function readPlaylistAddStatus(env: Pick<PlaylistAddEnv, 'global_settings'>, videoIds: string[], userId: string): Promise<AddStatusItem[]> {
	const items: AddStatusItem[] = [];
	for (const videoId of [...new Set(videoIds)].filter(isValidId).slice(0, MAX_STATUS_VIDEOS)) {
		const listed = await env.global_settings.list({ prefix: `${PLAYLIST_ADD_PREFIX}${videoId}/`, limit: MAX_PLAYLISTS_PER_VIDEO * 2 });
		for (const object of listed.objects) {
			const record = await records(env).getObject(object.key);
			if (!record || record.requestedBy !== userId) continue;
			items.push({ videoId, playlistId: record.playlistId, status: record.status, attempts: record.attempts, ...(record.refusal ? { refusal: record.refusal } : {}) });
		}
	}
	return items;
}

