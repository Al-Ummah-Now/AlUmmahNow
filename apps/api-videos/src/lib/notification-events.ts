/**
 * Producers of subscriber-facing notification events (Story 29.10).
 *
 * api-videos only enqueues: the processor fans the notification out to the
 * channel's subscribers (respecting each subscriber's bell and settings) and
 * de-duplicates per video / live stream, so calling these more than once for
 * the same entity is harmless.
 */

import { isShort, MessageType, type VideoFormatInput } from '@al-ummah/shared-types';
import R2Repository from './r2Repo';
import { logger } from './logger';
import { enqueueFanout, NotificationsEnv } from './notifications';
import { isVideoPubliclyVisible } from './visibility';

interface PublishableVideo {
	id: string;
	userId?: string;
	channelId?: string;
	title?: string;
	duration?: number;
	width?: number;
	height?: number;
	format?: 'short' | 'video';
	isPublic?: boolean;
	isHidden?: boolean;
	isDeleted?: boolean;
	uploadStatus?: string;
	scheduledPublishStatus?: string;
}

interface EventsEnv extends NotificationsEnv {
	channels: R2Bucket;
}

/** Ready, public, not waiting for a schedule: subscribers may be told about it. */
export function isAnnounceable(video: PublishableVideo | null | undefined): boolean {
	if (!video?.channelId || !isVideoPubliclyVisible(video)) return false;
	if (video.uploadStatus && video.uploadStatus !== 'ready') return false;
	return video.scheduledPublishStatus !== 'scheduled' && video.scheduledPublishStatus !== 'publishing';
}

/** Long-form uploads are highlights; Shorts (Lamahat, shared rule) only reach bell = all. */
export function isHighlightVideo(video: VideoFormatInput): boolean {
	return !isShort(video);
}

async function channelName(env: EventsEnv, channelId: string): Promise<string> {
	try {
		const channel = await new R2Repository<{ name?: string }>(env.channels).getObject(channelId);
		return channel?.name || '';
	} catch (error) {
		logger.warn('[notification-events] Channel lookup failed', { channelId, error });
		return '';
	}
}

/** Tell subscribers about a newly published video (no-op unless announceable). */
export async function announceNewVideo(env: EventsEnv, video: PublishableVideo): Promise<boolean> {
	if (!isAnnounceable(video)) return false;
	return enqueueFanout(env, {
		kind: 'new_video',
		channelId: video.channelId as string,
		entityId: video.id,
		isHighlight: isHighlightVideo(video),
		params: { channelName: await channelName(env, video.channelId as string), videoTitle: video.title || '' },
		actionUrl: `/video/${video.id}`,
		actorUserId: video.userId,
	});
}

/** Tell subscribers a live stream started. */
export async function announceLiveStarted(
	env: EventsEnv,
	stream: { id: string; channelId?: string; userId?: string; title?: string },
): Promise<boolean> {
	if (!stream.channelId) return false;
	return enqueueFanout(env, {
		kind: 'live_started',
		channelId: stream.channelId,
		entityId: stream.id,
		isHighlight: true,
		params: { channelName: await channelName(env, stream.channelId), streamTitle: stream.title || '' },
		// The live watch page `/live/{id}` is Story 29.17; link to the live listing until then
		actionUrl: `/live`,
		actorUserId: stream.userId,
	});
}

/**
 * Upload processing reached a terminal state: the processor stores the
 * uploader's notification (ready / failed) and, when published, subscribers are told.
 */
export async function announceProcessingResult(env: EventsEnv, video: PublishableVideo, status: 'ready' | 'failed'): Promise<void> {
	if (env.queue) {
		try {
			await env.queue.send({
				id: crypto.randomUUID(),
				type: status === 'ready' ? MessageType.VideoProcessingCompleted : MessageType.VideoUploadFailed,
				payload: {
					videoId: video.id,
					userId: video.userId,
					channelId: video.channelId,
					title: video.title,
					duration: video.duration,
					timestamp: new Date().toISOString(),
				},
				timestamp: Date.now(),
			});
		} catch (error) {
			logger.warn('[notification-events] Failed to enqueue processing result', { videoId: video.id, status, error });
		}
	}
	if (status === 'ready') await announceNewVideo(env, { ...video, uploadStatus: 'ready' });
}
