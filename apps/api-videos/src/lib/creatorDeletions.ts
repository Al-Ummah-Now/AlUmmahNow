/**
 * Creator deletes are soft (owner rule 2026-11-10, same registry as the admin's
 * Recently deleted: lib/admin/deletions.ts). A deleted video is hidden at once
 * and stays restorable for 30 days; "Delete permanently" only queues it, and the
 * hourly cleanup is the one path that erases it.
 *
 * Who may act: the owner, or a channel member whose role allows video.delete
 * (editors only their own uploads; lib/channelAccess.ts canOnVideo).
 */
import type { AdminDeletion, VideoObject } from '@al-ummah/shared-types';
import { canOnVideo } from './channelAccess';
import { listChannelDeletions } from './admin/deletions';
import { AdminError, deleteVideo, requestDeletionPurge, restoreVideo, type AdminServiceEnv } from './admin/service';
import R2Repository from './r2Repo';

export type CreatorDeletionResult = { videoId: string; success: boolean; error?: string; deletion?: AdminDeletion };

type Env = AdminServiceEnv & { videos: R2Bucket };

async function allowed(env: Env, videoId: string, userId: string): Promise<VideoObject | string> {
	if (videoId.includes(':')) return 'Video not found';
	const video = await new R2Repository<VideoObject>(env.videos).getObject(videoId);
	if (!video) return 'Video not found';
	if (!(await canOnVideo(env as never, video, userId, 'video.delete'))) return 'Forbidden - you can only delete your own videos';
	return video;
}

const failure = (videoId: string, error: unknown): CreatorDeletionResult => ({
	videoId,
	success: false,
	error: error instanceof AdminError ? error.code : error instanceof Error ? error.message : 'Unknown error',
});

/** Soft-deletes one video for its owner or a member allowed to. Already deleted counts as done. */
export async function softDeleteForCreator(env: Env, videoId: string, userId: string): Promise<CreatorDeletionResult> {
	try {
		const video = await allowed(env, videoId, userId);
		if (typeof video === 'string') return { videoId, success: false, error: video };
		if (video.isDeleted === true) return { videoId, success: true };
		const { deletion } = await deleteVideo(env, videoId, userId);
		return { videoId, success: true, deletion };
	} catch (error) {
		return failure(videoId, error);
	}
}

/** Restores a soft-deleted video (refused once its permanent deletion has started). */
export async function restoreForCreator(env: Env, videoId: string, userId: string): Promise<CreatorDeletionResult> {
	try {
		const video = await allowed(env, videoId, userId);
		if (typeof video === 'string') return { videoId, success: false, error: video };
		await restoreVideo(env, videoId);
		return { videoId, success: true };
	} catch (error) {
		return failure(videoId, error);
	}
}

/** "Delete permanently": queues the video for the next cleanup run. Idempotent. */
export async function purgeForCreator(env: Env, videoId: string, userId: string): Promise<CreatorDeletionResult> {
	try {
		const video = await allowed(env, videoId, userId);
		if (typeof video === 'string') return { videoId, success: false, error: video };
		const deletion = await requestDeletionPurge(env, 'video', videoId, userId);
		return { videoId, success: true, deletion };
	} catch (error) {
		return failure(videoId, error);
	}
}

/** A channel's soft-deleted videos not yet purged, newest first. */
export function channelDeletedVideos(env: Env, channelId: string, cursor?: string | null, pageSize = 30) {
	return listChannelDeletions(env.SEARCH_DB!, { kind: 'video', channelId, cursor, pageSize });
}

export function summarize(results: CreatorDeletionResult[]) {
	const succeeded = results.filter((r) => r.success).length;
	return {
		success: true,
		results: results.map(({ deletion: _deletion, ...rest }) => rest),
		summary: { total: results.length, succeeded, failed: results.length - succeeded },
	};
}
