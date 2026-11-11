/**
 * Creator soft deletes of videos: the rules (owner rule 2026-11-10, same as
 * admin deletes). DELETE /api/videos/:id and bulk-delete hide the video at
 * once and keep it restorable for 30 days; then the hourly deletion cleanup
 * (lib/admin/deletions.ts runDeletionCleanup) purges it through the admin
 * video.purge job: R2 record, Bunny Stream video, notifications and the
 * VideoDelete message, exactly what the old hard delete did.
 *
 * The registry is SEARCH_DB.admin_deletions (kind 'video'), shared with admin
 * deletes, so the cleanup, the admin's "Recently deleted" and the admin
 * restore cover creator deletes too. A creator delete is told apart from an
 * admin (moderation) delete, which a creator may never undo or purge:
 *   - new creator deletes carry `ownerDeletion` on the video and the row
 *     reason OWNER_DELETE_REASON;
 *   - the first Studio creator deletes (before this module) carry
 *     `adminDeletion` with `by` = the owner, the uploader or a channel member.
 *
 *   delete    → isDeleted, deletedAt, deletedBy, ownerDeletion, hold owner:deleted; row recorded
 *   restore   → marks removed, hold lifted, row removed. Refused (410) once the
 *               30 days are up or the purge has started; a queued purge
 *               ("Delete permanently", bulk-purge) can still be undone
 *   purge     → bulk-purge queues the row for the next run; DELETE …/permanent starts it now
 *
 * Every write goes through the request's search-sync wrapped bucket, so the
 * search and ownership indexes drop the video on delete and take it back on
 * restore (lib/search/sync.ts; isDeleted/isHidden rows are not listed).
 */
import {
	applySuspensionHold,
	liftSuspensionHold,
	purgeAfterOf,
	SOFT_DELETE_RETENTION_DAYS,
	type AdminDeletion,
	type SearchDb,
	type SuspendableRecord,
} from '@al-ummah/shared-types';
import R2Repository from './r2Repo';
import Queue, { MessageType } from './queue';
import { logger } from './logger';
import { getDeletion, pendingDeletion, purgeDeletionNow, recordDeletion, removeDeletion, requestPurge } from './admin/deletions';
import { purgeDeletion, type AdminServiceEnv } from './admin/service';
import { publicVideoFields } from './transformations';
import { OWNER_DELETE_REASON, OWNER_DELETED_HOLD, type OwnerDeletionMark } from './videoTrashMarks';

export { OWNER_DELETE_REASON, OWNER_DELETED_HOLD };

type Row = Record<string, any>;
export type TrashEnv = AdminServiceEnv;

const DAY_MS = 86_400_000;
/** The hold an admin delete puts on the video (lib/admin/service.ts). */
const ADMIN_DELETED_HOLD = 'admin:deleted';

export type TrashErrorCode =
	| 'video_not_found'
	| 'forbidden'
	| 'not_deleted'
	| 'deleted_by_admin'
	| 'restore_window_expired'
	| 'trash_unavailable';

const STATUS: Record<TrashErrorCode, 403 | 404 | 409 | 410 | 503> = {
	video_not_found: 404,
	forbidden: 403,
	not_deleted: 409,
	deleted_by_admin: 403,
	restore_window_expired: 410,
	trash_unavailable: 503,
};

const MESSAGES: Record<TrashErrorCode, string> = {
	video_not_found: 'Video not found',
	forbidden: 'Forbidden - you cannot manage this video',
	not_deleted: 'Video is not deleted',
	deleted_by_admin: 'This video was removed by an administrator',
	restore_window_expired: 'This video can no longer be restored',
	trash_unavailable: 'Deleting videos is unavailable right now, try again shortly',
};

export class TrashError extends Error {
	readonly status: 403 | 404 | 409 | 410 | 503;
	constructor(readonly code: TrashErrorCode) {
		super(MESSAGES[code]);
		this.status = STATUS[code];
	}
}

/** The `{ success: false, error, code }` body and status a route answers for a TrashError. */
export function trashErrorBody(error: TrashError) {
	return { body: { success: false as const, error: error.message, code: error.code }, status: error.status };
}

/** The last moment a delete made at `deletedAt` can be restored (ISO). */
export const restorableUntilOf = (deletedAt: string) => purgeAfterOf(deletedAt);

const repo = (env: TrashEnv) => new R2Repository<Row>(env.videos);

function db(env: TrashEnv): SearchDb {
	const searchDb = (env as { SEARCH_DB?: SearchDb }).SEARCH_DB;
	if (!searchDb) throw new TrashError('trash_unavailable');
	return searchDb;
}

/** Owner and members of a channel: the people whose deletes are creator deletes. */
async function channelPeople(env: TrashEnv, channelId: string | null | undefined): Promise<Set<string>> {
	const people = new Set<string>();
	if (!channelId || !env.channels) return people;
	try {
		const channel = await new R2Repository<Row>(env.channels).getObject(channelId);
		if (channel?.userId) people.add(channel.userId);
		for (const m of Array.isArray(channel?.members) ? channel.members : []) if (m?.userId) people.add(m.userId);
	} catch (error) {
		logger.warn('[VideoTrash] Channel read failed', { channelId, error: error instanceof Error ? error.message : String(error) });
	}
	return people;
}

/** Whether a deleted video was deleted by its creator side (not by an admin). */
export async function isCreatorDeletion(env: TrashEnv, video: Row): Promise<boolean> {
	if (video.isDeleted !== true) return false;
	if (video.ownerDeletion) return true;
	const by = video.adminDeletion?.by as string | undefined;
	if (!by) return false;
	if (by === video.userId || by === video.uploadedBy) return true;
	return (await channelPeople(env, video.channelId)).has(by);
}

async function notify(env: TrashEnv, video: Row, action: 'deleted' | 'restored', actorId: string): Promise<void> {
	try {
		await new Queue(env.queue as never).send(MessageType.VideoEdit, {
			videoId: video.id,
			userId: video.userId,
			channelId: video.channelId,
			action,
			actorId,
			source: 'owner',
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		logger.warn('[VideoTrash] Queue send failed', { videoId: video.id, action, error: error instanceof Error ? error.message : String(error) });
	}
}

const deletedAtOf = (video: Row): string => video.ownerDeletion?.at ?? video.adminDeletion?.at ?? video.deletedAt ?? new Date(0).toISOString();

export interface SoftDeleteOutcome {
	deletedAt: string;
	restorableUntil: string;
	/** true when it was already in the trash (the delete is idempotent) */
	alreadyDeleted: boolean;
}

/**
 * Soft-deletes a video the caller may delete (callers check access).
 * Deleting a video already in the creator trash answers its existing times;
 * a video an admin removed is 403 deleted_by_admin; a missing one 404.
 */
export async function softDeleteVideo(env: TrashEnv, id: string, actorId: string, now = Date.now()): Promise<SoftDeleteOutcome> {
	const searchDb = db(env);
	if (id.includes(':')) throw new TrashError('video_not_found');
	const at = new Date(now).toISOString();
	const saved = await repo(env).updateObject(id, (fresh) => {
		if (fresh.isDeleted === true) return false;
		const mark: OwnerDeletionMark = { at, by: actorId };
		fresh.isDeleted = true;
		fresh.deletedAt = at;
		fresh.deletedBy = actorId;
		fresh.ownerDeletion = mark;
		applySuspensionHold(fresh as SuspendableRecord, OWNER_DELETED_HOLD);
		fresh.dateModified = at;
		return true;
	});
	if (!saved) throw new TrashError('video_not_found');
	if ((saved.ownerDeletion as OwnerDeletionMark | undefined)?.at !== at) {
		// Deleted before this call
		if (!(await isCreatorDeletion(env, { ...saved, id }))) throw new TrashError('deleted_by_admin');
		const deletedAt = deletedAtOf(saved);
		return { deletedAt, restorableUntil: restorableUntilOf(deletedAt), alreadyDeleted: true };
	}
	await recordDeletion(searchDb, {
		kind: 'video',
		id,
		title: saved.title ?? id,
		ownerId: saved.userId ?? null,
		channelId: saved.channelId ?? null,
		deletedBy: actorId,
		reason: OWNER_DELETE_REASON,
		deletedAt: at,
	});
	await notify(env, { ...saved, id }, 'deleted', actorId);
	logger.debug('[VideoTrash] Video soft-deleted', { videoId: id, actorId });
	return { deletedAt: at, restorableUntil: restorableUntilOf(at), alreadyDeleted: false };
}

/**
 * The creator deletion of `video` if it can still be restored: not deleted
 * (409), an admin delete (403), purge started or 30 days up (410).
 */
async function restorableDeletion(env: TrashEnv, video: Row, now: number): Promise<AdminDeletion> {
	if (video.isDeleted !== true) throw new TrashError('not_deleted');
	if (!(await isCreatorDeletion(env, video))) throw new TrashError('deleted_by_admin');
	const deletion = await pendingDeletion(db(env), 'video', video.id);
	if (!deletion || deletion.purgeStartedAt) throw new TrashError('restore_window_expired');
	if (now >= Date.parse(restorableUntilOf(deletion.deletedAt))) throw new TrashError('restore_window_expired');
	return deletion;
}

/** Restores a creator-deleted video (callers check access on `video`). */
export async function restoreDeletedVideo(env: TrashEnv, video: Row, actorId: string, now = Date.now()): Promise<{ restoredAt: string }> {
	await restorableDeletion(env, video, now);
	const at = new Date(now).toISOString();
	const saved = await repo(env).updateObject(video.id, (fresh) => {
		if (fresh.isDeleted !== true) return false;
		fresh.isDeleted = false;
		delete fresh.deletedAt;
		delete fresh.deletedBy;
		delete fresh.ownerDeletion;
		delete fresh.adminDeletion;
		liftSuspensionHold(fresh as SuspendableRecord, OWNER_DELETED_HOLD);
		liftSuspensionHold(fresh as SuspendableRecord, ADMIN_DELETED_HOLD);
		fresh.dateModified = at;
		return true;
	});
	if (!saved) throw new TrashError('video_not_found');
	await removeDeletion(db(env), 'video', video.id);
	await notify(env, { ...saved, id: video.id }, 'restored', actorId);
	logger.debug('[VideoTrash] Video restored', { videoId: video.id, actorId });
	return { restoredAt: at };
}

/** Records the row of a creator delete again when it is missing (a write that failed half way). */
async function ensureRow(env: TrashEnv, video: Row, actorId: string, now: number): Promise<void> {
	if (await getDeletion(db(env), 'video', video.id)) return;
	await recordDeletion(db(env), {
		kind: 'video',
		id: video.id,
		title: video.title ?? video.id,
		ownerId: video.userId ?? null,
		channelId: video.channelId ?? null,
		deletedBy: video.ownerDeletion?.by ?? video.adminDeletion?.by ?? actorId,
		reason: OWNER_DELETE_REASON,
		deletedAt: video.ownerDeletion?.at ?? video.adminDeletion?.at ?? new Date(now).toISOString(),
	});
}

/**
 * "Delete permanently" (Studio bulk-purge): queues a creator-deleted video
 * for the next cleanup run; it stays restorable until that run starts it.
 */
export async function queuePurge(env: TrashEnv, video: Row, actorId: string, now = Date.now()): Promise<AdminDeletion> {
	if (video.isDeleted !== true) throw new TrashError('not_deleted');
	if (!(await isCreatorDeletion(env, video))) throw new TrashError('deleted_by_admin');
	await ensureRow(env, video, actorId, now);
	await requestPurge(db(env), 'video', video.id, actorId, new Date(now).toISOString());
	const deletion = await pendingDeletion(db(env), 'video', video.id);
	if (!deletion) throw new TrashError('restore_window_expired');
	return deletion;
}

/**
 * DELETE /api/videos/:id/permanent: a live video is soft-deleted first, then
 * its purge job starts at once (the cleanup retries a start that failed). An
 * admin delete is not the creator's to purge (403).
 */
export async function purgeVideoNow(env: TrashEnv, video: Row, actorId: string, now = Date.now()): Promise<{ purgeRequestedAt: string; purgeStarted: boolean }> {
	db(env);
	if (video.isDeleted !== true) {
		await softDeleteVideo(env, video.id, actorId, now);
	} else {
		if (!(await isCreatorDeletion(env, video))) throw new TrashError('deleted_by_admin');
		await ensureRow(env, video, actorId, now);
	}
	const deletion = await purgeDeletionNow(env as never, 'video', video.id, actorId, (d) => purgeDeletion(env, d), now);
	if (!deletion) throw new TrashError('video_not_found');
	logger.info('[VideoTrash] Permanent delete started', { videoId: video.id, actorId, jobId: deletion.purgeJobId });
	return { purgeRequestedAt: deletion.purgeRequestedAt ?? new Date(now).toISOString(), purgeStarted: Boolean(deletion.purgeStartedAt) };
}

interface TrashRow {
	target_id: string;
	title: string;
	deleted_at: string;
	deleted_by: string;
	reason: string | null;
	purge_requested_at: string | null;
	purge_started_at: string | null;
}

/**
 * One page of a channel's creator deletes still in their 30 days and not
 * being purged, newest first (admin removals are left out). Cursor =
 * `<deleted_at>|<video id>`. Pages can come back short when rows are
 * filtered; follow the cursor until it is null.
 */
export async function channelTrashRows(
	env: TrashEnv,
	channelId: string,
	query: { limit?: number; cursor?: string | null },
	now = Date.now(),
): Promise<{ rows: TrashRow[]; cursor: string | null }> {
	const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
	const where = ["kind = 'video'", 'channel_id = ?', 'purged_at IS NULL', 'purge_started_at IS NULL', 'deleted_at > ?'];
	const args: unknown[] = [channelId, new Date(now - SOFT_DELETE_RETENTION_DAYS * DAY_MS).toISOString()];
	if (query.cursor) {
		const split = query.cursor.lastIndexOf('|');
		if (split > 0) {
			const at = query.cursor.slice(0, split);
			where.push('(deleted_at < ? OR (deleted_at = ? AND target_id < ?))');
			args.push(at, at, query.cursor.slice(split + 1));
		}
	}
	const { results } = await db(env)
		.prepare(
			`SELECT target_id, title, deleted_at, deleted_by, reason, purge_requested_at, purge_started_at FROM admin_deletions WHERE ${where.join(' AND ')} ORDER BY deleted_at DESC, target_id DESC LIMIT ?`,
		)
		.bind(...args, limit + 1)
		.all<TrashRow>();
	const all = (results ?? []) as TrashRow[];
	const page = all.slice(0, limit);
	const people = await channelPeople(env, channelId);
	const rows = page.filter((r) => r.reason === OWNER_DELETE_REASON || people.has(r.deleted_by));
	const last = page[page.length - 1];
	return { rows, cursor: all.length > limit && last ? `${last.deleted_at}|${last.target_id}` : null };
}

/** Internal fields a trash item never shows. */
function trashView(video: Row, deletedAt: string): Row {
	const { ownerDeletion: _o, adminDeletion: _a, suspensionHolds: _h, hiddenBeforeSuspension: _b, deletedBy: _d, ...rest } = publicVideoFields(video) as Row;
	return { ...rest, isDeleted: true, deletedAt, restorableUntil: restorableUntilOf(deletedAt) };
}

/**
 * GET /api/channels/:id/deleted-videos: the channel trash as full video
 * views. `mayManage` drops items the caller may not delete (an editor sees
 * only their own uploads).
 */
export async function listDeletedVideos(
	env: TrashEnv,
	channelId: string,
	query: { limit?: number; cursor?: string | null; mayManage?: (video: Row) => boolean },
	now = Date.now(),
): Promise<{ items: Row[]; cursor: string | null }> {
	const { rows, cursor } = await channelTrashRows(env, channelId, query, now);
	const videos = await Promise.all(rows.map((row) => repo(env).getObject(row.target_id)));
	const items: Row[] = [];
	rows.forEach((row, i) => {
		const video = videos[i];
		// The record is the truth: restored or purged meanwhile is not in the trash
		if (!video || video.isDeleted !== true || video.channelId !== channelId) return;
		if (query.mayManage && !query.mayManage(video)) return;
		items.push(trashView({ ...video, id: video.id ?? row.target_id }, row.deleted_at));
	});
	return { items, cursor };
}
