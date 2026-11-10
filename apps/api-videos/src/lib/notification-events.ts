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
	processingCheck?: { loopId?: string };
	processingIssue?: { at?: string };
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

export type ProcessingResult = 'ready' | 'failed';

/**
 * Which processing attempt a result belongs to. The processor dedupes the
 * uploader's notification on it, so a redelivered message is stored once while
 * a genuine second result (after an admin retry or a re-upload) still lands.
 * Stable per attempt: a failure keyed by when it was flagged (plus the loop
 * that flagged it, so an admin retry failing in the same millisecond is still
 * a new attempt), otherwise by the processing loop that produced the result.
 */
export function processingAttempt(video: PublishableVideo, status: ProcessingResult): string | undefined {
	const loopId = video.processingCheck?.loopId;
	if (status === 'failed' && video.processingIssue?.at) return `issue:${video.processingIssue.at}${loopId ? `:${loopId}` : ''}`;
	return loopId ? `loop:${loopId}` : undefined;
}

/**
 * Upload processing reached a terminal state: the processor stores the
 * uploader's notification (ready / failed, one per processing attempt) and, when published,
 * subscribers are told (the fan-out skips the uploader).
 *
 * Throws when a message could not be queued, so a queue-driven caller (the
 * processing-check loop) retries and finally dead-letters, which alerts the
 * admins. Repeats are harmless: the processor de-duplicates per video and attempt.
 */
export async function announceProcessingResult(env: EventsEnv, video: PublishableVideo, status: ProcessingResult): Promise<void> {
	if (!env.queue) {
		logger.warn('[notification-events] Queue not bound; processing result not announced', { videoId: video.id, status });
		return;
	}
	await env.queue.send({
		id: crypto.randomUUID(),
		type: status === 'ready' ? MessageType.VideoProcessingCompleted : MessageType.VideoUploadFailed,
		payload: {
			videoId: video.id,
			userId: video.userId,
			channelId: video.channelId,
			title: video.title,
			duration: video.duration,
			attempt: processingAttempt(video, status),
			timestamp: new Date().toISOString(),
		},
		timestamp: Date.now(),
	});
	if (status === 'ready') {
		const published = { ...video, uploadStatus: 'ready' };
		if (isAnnounceable(published) && !(await announceNewVideo(env, published))) {
			throw new Error('Subscriber fan-out could not be queued');
		}
	}
}

interface AnnounceableRecord extends PublishableVideo {
	processingAnnounced?: ProcessingResult;
}

/** The terminal status still waiting for its announcement, or null. */
export function pendingProcessingResult(video: AnnounceableRecord | null | undefined): ProcessingResult | null {
	const status = video?.uploadStatus;
	if (status !== 'ready' && status !== 'failed') return null;
	return video?.processingAnnounced === status ? null : status;
}

/**
 * Announce a terminal status and record it on the video, so the processing
 * loop knows the announcement landed (and repeats it on its next attempt if not).
 */
export async function announceAndRecordProcessingResult(
	env: EventsEnv & { videos: R2Bucket },
	video: AnnounceableRecord,
	status: ProcessingResult,
): Promise<void> {
	await announceProcessingResult(env, video, status);
	await new R2Repository<AnnounceableRecord>(env.videos).updateObject(video.id, (fresh) => {
		if (fresh.uploadStatus !== status || fresh.processingAnnounced === status) return false;
		fresh.processingAnnounced = status;
		return true;
	});
	logger.info('[notification-events] Processing result announced', { videoId: video.id, status });
}
