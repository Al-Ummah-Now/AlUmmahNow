/**
 * Queue the automated check of a video (docs/specs/VIDEO-REVIEW.md §3).
 *
 * One scan per review. Upload reviews are sent when the R2 transcode reports ready with the review
 * media (frames + audio) or fails for good (partial: metadata and thumbnail only); a video that is
 * never transcoded is scanned at once (partial). Resubmits, metadata edits and live VODs call
 * this directly. Never throws: a scan that cannot be queued leaves an enforce-mode video held,
 * never published (the admin "stuck checking" view finds it).
 */
import {
	MessageType,
	effectiveReviewMode,
	readVideoReviewSettings,
	scansInMode,
	type ReviewExtractionOptions,
	type ReviewSettingsBucket,
	type VideoReviewScanPayload,
	type VideoReviewSettings,
	type VideoReviewShadowMarker,
	type VideoReviewState,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import { videoScanText } from '../moderation-scan';

export interface ReviewScanEnv {
	videos: R2Bucket;
	global_settings?: unknown;
	MODERATION_QUEUE?: { send(message: unknown): Promise<unknown> };
	VIDEO_REVIEW_ALLOWED?: string;
}

interface ScannableVideo {
	id: string;
	userId?: string;
	channelId?: string | null;
	title?: string;
	description?: string;
	tags?: string[];
	titleLocalized?: Record<string, string>;
	descriptionLocalized?: Record<string, string>;
	thumbnailUrl?: string;
	review?: VideoReviewState;
	reviewShadow?: VideoReviewShadowMarker;
}

/** The transcode job's review options, or undefined when review is off here (no extraction). */
export async function reviewExtractionFor(env: Pick<ReviewScanEnv, 'global_settings' | 'VIDEO_REVIEW_ALLOWED'>): Promise<ReviewExtractionOptions | undefined> {
	const settings = await readVideoReviewSettings(env.global_settings as ReviewSettingsBucket | undefined);
	if (!scansInMode(effectiveReviewMode(settings, env.VIDEO_REVIEW_ALLOWED))) return undefined;
	return { frameIntervalSeconds: settings.frameIntervalSeconds, sceneThreshold: settings.sceneThreshold, maxFrames: settings.maxFrames };
}

export type ScanTrigger = VideoReviewScanPayload['trigger'];

/**
 * Queue the scan for the video's current review (or, in shadow mode, a recorded-only one).
 * `force` re-queues even when this review was already scanned (resubmit uses a new review id).
 */
export async function queueReviewScan(
	env: ReviewScanEnv,
	videoId: string,
	opts: { trigger: ScanTrigger; manifestKey?: string; force?: boolean; now?: Date },
): Promise<{ queued: boolean; why?: string }> {
	try {
		if (!env.MODERATION_QUEUE) return { queued: false, why: 'moderation queue not bound' };
		const settings: VideoReviewSettings = await readVideoReviewSettings(env.global_settings as ReviewSettingsBucket | undefined);
		const mode = effectiveReviewMode(settings, env.VIDEO_REVIEW_ALLOWED);
		if (!scansInMode(mode)) return { queued: false, why: 'review is off' };
		const now = opts.now ?? new Date();
		let payload: VideoReviewScanPayload | null = null;
		let why: string | undefined;
		await new R2Repository<ScannableVideo>(env.videos).updateObject(videoId, (video) => {
			payload = null;
			why = undefined;
			let reviewId: string;
			let timing: VideoReviewScanPayload['timing'];
			if (video.review) {
				if (video.review.scanQueuedAt && !opts.force) {
					why = 'already queued';
					return false;
				}
				reviewId = video.review.reviewId;
				timing = video.review.timing;
				video.review.scanQueuedAt = now.toISOString();
				if (opts.manifestKey) video.review.manifestKey = opts.manifestKey;
			} else if (mode === 'shadow') {
				if (video.reviewShadow && !opts.force) {
					why = 'already queued';
					return false;
				}
				reviewId = crypto.randomUUID();
				timing = 'pre';
				video.reviewShadow = { reviewId, queuedAt: now.toISOString() };
			} else {
				// Enforce mode but never gated (uploaded before review was on): a metadata edit is
				// still checked, as a trusted-style post-hoc review that only NSFW can pull back
				reviewId = crypto.randomUUID();
				timing = 'post';
				video.review = { status: 'post_review', reviewId, timing, since: now.toISOString(), scanQueuedAt: now.toISOString() };
			}
			payload = {
				videoId,
				reviewId,
				channelId: video.channelId ?? undefined,
				ownerId: video.userId,
				timing,
				mode,
				metadataText: videoScanText(video),
				...(video.thumbnailUrl ? { thumbnail: { url: video.thumbnailUrl } } : {}),
				...(opts.manifestKey ?? video.review?.manifestKey ? { manifestKey: opts.manifestKey ?? video.review?.manifestKey } : {}),
				trigger: opts.trigger,
				settings,
				queuedAt: now.toISOString(),
			};
			return true;
		});
		if (!payload) return { queued: false, why: why ?? 'video not found' };
		await env.MODERATION_QUEUE.send({ id: crypto.randomUUID(), type: MessageType.VideoReviewScan, payload, timestamp: now.getTime() });
		logger.debug('[Review] Scan queued', { videoId, trigger: opts.trigger, mode, partial: !(payload as VideoReviewScanPayload).manifestKey });
		return { queued: true };
	} catch (error) {
		logger.error('[Review] Could not queue the scan; an enforce-mode video stays held', { videoId, trigger: opts.trigger, error: error instanceof Error ? error.message : String(error) });
		return { queued: false, why: 'error' };
	}
}
