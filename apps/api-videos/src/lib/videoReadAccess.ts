/**
 * Who may read one video by id: the rule of the video's own public read (GET /api/videos/:id),
 * shared by every by-id read of the video or of what belongs to it (playback, captions), so a
 * video hidden from someone is hidden on every surface (#1241).
 *
 * - Removed (soft-deleted, hidden by moderation or a held review, in a deleted channel, internal
 *   record): no one.
 * - Open to anyone (public or unlisted, released, ready): everyone. Responses may be cached
 *   publicly.
 * - Otherwise (private, draft, scheduled, still processing, held): the owner, or a channel member
 *   allowed to see private videos (lib/channelAccess.ts). Responses must never be cached publicly.
 *
 * Everyone else gets the same 404 as a missing video, so a hidden video's existence never leaks.
 */
import { canOnVideo, type AccessVideo } from './channelAccess';
import { isRestrictedVideo, isVideoOpenToAnyone, isVideoRemoved, type VisibilityFields } from './visibility';
import { isInternalVideoKey } from '@al-ummah/shared-types';

/** 'anyone': open to everyone (publicly cacheable); 'viewer': only this signed-in viewer may read it. */
export type VideoReadAccess = 'anyone' | 'viewer';

export async function videoReadAccess(
	env: unknown,
	video: (VisibilityFields & AccessVideo) | null | undefined,
	userId: string | null | undefined,
): Promise<VideoReadAccess | null> {
	if (!video || isVideoRemoved(video)) return null;
	if (!isRestrictedVideo(video) && isVideoOpenToAnyone(video)) return 'anyone';
	return (await canOnVideo(env as never, video, userId, 'video.view_private')) ? 'viewer' : null;
}

/** A private video this viewer may not open: the check of what hangs on a video (comments, views, watch time). */
export async function isClosedTo(env: unknown, video: VisibilityFields & AccessVideo, userId: string | null | undefined): Promise<boolean> {
	return isRestrictedVideo(video) && !(await canOnVideo(env as never, video, userId, 'video.view_private'));
}

/** The video GET's answer for a missing or hidden video. */
export const VIDEO_NOT_FOUND = { success: false, error: 'Object not found' } as const;

/** Reads the video record by id from the videos bucket; null when absent or unreadable. */
export async function loadVideoRecord<T = Record<string, unknown>>(env: { videos?: R2Bucket }, videoId: string): Promise<T | null> {
	if (isInternalVideoKey(videoId)) return null;
	const obj = await env.videos?.get(videoId).catch(() => null);
	if (!obj) return null;
	return ((await obj.json().catch(() => null)) as T | null) ?? null;
}
