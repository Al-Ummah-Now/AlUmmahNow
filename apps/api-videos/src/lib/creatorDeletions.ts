/**
 * Creator deletes for the Studio routes (bulk-delete, bulk-restore,
 * bulk-purge): access checks and per-video results. The rules live in
 * lib/videoTrash.ts (restorable for 30 days, admin removals are not the
 * creator's to undo, the hourly cleanup erases what is due).
 *
 * Who may act: the owner, or a channel member whose role allows video.delete
 * (editors only their own uploads; lib/channelAccess.ts canOnVideo).
 */
import type { VideoObject } from '@al-ummah/shared-types';
import { canOnVideo } from './channelAccess';
import { logger } from './logger';
import R2Repository from './r2Repo';
import { queuePurge, restoreDeletedVideo, softDeleteVideo, TrashError, type TrashEnv } from './videoTrash';

export type CreatorDeletionResult = {
	videoId: string;
	success: boolean;
	error?: string;
	/** lib/videoTrash.ts TrashErrorCode when it failed */
	code?: string;
	/** Delete: until when it can be restored (ISO) */
	restorableUntil?: string;
};

type Env = TrashEnv & { videos: R2Bucket };

type Video = VideoObject & Record<string, any>;

/** The video when `userId` may delete it, or the refusal. */
async function allowed(env: Env, videoId: string, userId: string): Promise<{ video: Video } | { refused: CreatorDeletionResult }> {
	const notFound = { refused: { videoId, success: false, error: 'Video not found', code: 'video_not_found' } };
	if (videoId.includes(':')) return notFound;
	const video = await new R2Repository<Video>(env.videos).getObject(videoId);
	if (!video) return notFound;
	if (!(await canOnVideo(env as never, video, userId, 'video.delete'))) {
		return { refused: { videoId, success: false, error: 'Forbidden - you can only manage your own videos', code: 'forbidden' } };
	}
	return { video: { ...video, id: videoId } };
}

function failure(videoId: string, error: unknown, step: string): CreatorDeletionResult {
	if (error instanceof TrashError) return { videoId, success: false, error: error.message, code: error.code };
	logger.error(`[CreatorDeletions] ${step} failed`, { videoId, error: error instanceof Error ? error.message : String(error) });
	return { videoId, success: false, error: `${step} failed` };
}

/** Soft-deletes one video for its owner or a member allowed to. Already in the trash counts as done. */
export async function softDeleteForCreator(env: Env, videoId: string, userId: string): Promise<CreatorDeletionResult> {
	try {
		const access = await allowed(env, videoId, userId);
		if ('refused' in access) return access.refused;
		const { video } = access;
		const { restorableUntil } = await softDeleteVideo(env, videoId, userId);
		return { videoId, success: true, restorableUntil };
	} catch (error) {
		return failure(videoId, error, 'Delete');
	}
}

/** Restores a creator-deleted video (refused once its purge started or its 30 days are up). */
export async function restoreForCreator(env: Env, videoId: string, userId: string): Promise<CreatorDeletionResult> {
	try {
		const access = await allowed(env, videoId, userId);
		if ('refused' in access) return access.refused;
		const { video } = access;
		await restoreDeletedVideo(env, video, userId);
		return { videoId, success: true };
	} catch (error) {
		return failure(videoId, error, 'Restore');
	}
}

/** "Delete permanently": queues the video for the next cleanup run. Idempotent. */
export async function purgeForCreator(env: Env, videoId: string, userId: string): Promise<CreatorDeletionResult> {
	try {
		const access = await allowed(env, videoId, userId);
		if ('refused' in access) return access.refused;
		const { video } = access;
		await queuePurge(env, video, userId);
		return { videoId, success: true };
	} catch (error) {
		return failure(videoId, error, 'Permanent delete');
	}
}

export function summarize(results: CreatorDeletionResult[]) {
	const succeeded = results.filter((r) => r.success).length;
	return {
		success: true,
		results,
		summary: { total: results.length, succeeded, failed: results.length - succeeded },
	};
}
