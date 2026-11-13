/**
 * The single writer of a video's `review` state (docs/specs/VIDEO-REVIEW.md §1.6, §3).
 *
 * - applyReviewOutcome: the processor's automated result (approve | hold)
 * - applyReviewDecision: a person's decision through admin-api (approve | reject | undo)
 * - appealReview / resubmitReview: the creator (owner or a member allowed to edit)
 *
 * Every change is a conditional write on the fresh video and checks the review id, so a stale
 * message (an older review, a replayed queue delivery) never overwrites a newer state. When a
 * change makes the video visible to everyone, the usual publish side effects follow: publishedAt
 * (lib/published.ts) and the subscriber announcement (VR8: a scheduled video released while it was
 * in review is announced on approval). The search index follows the write (search-sync wrapper).
 */
import {
	REVIEW_UNDO_MINUTES,
	isReviewReasonCode,
	isVideoPubliclyVisible,
	type NotificationCreatePayload,
	type ReviewDecisionRequest,
	type ReviewOutcomeRequest,
	type VideoReviewAppealPayload,
	type VideoReviewState,
	MessageType,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import { markPublished } from '../published';
import { announceNewVideo } from '../notification-events';
import { enqueueNotification, type NotificationsEnv } from '../notifications';
import { queueReviewScan, type ReviewScanEnv } from './scan';

export type ReviewApplyEnv = ReviewScanEnv & NotificationsEnv & { channels: R2Bucket };

interface ReviewedVideo {
	id: string;
	userId?: string;
	channelId?: string | null;
	title?: string;
	isPublic?: boolean;
	isDraft?: boolean;
	isUnlisted?: boolean;
	isHidden?: boolean;
	isDeleted?: boolean;
	uploadStatus?: string;
	scheduledPublishStatus?: string;
	publishedAt?: string;
	format?: 'short' | 'video';
	duration?: number;
	width?: number;
	height?: number;
	review?: VideoReviewState;
	dateModified?: string;
}

export type ApplyResult = { applied: true; review: VideoReviewState } | { applied: false; status: 404 | 409 | 400; why: string };

const repo = (env: ReviewApplyEnv) => new R2Repository<ReviewedVideo>(env.videos);

/** After a write: publish side effects when the video just became visible to everyone. */
async function afterVisibilityChange(env: ReviewApplyEnv, before: ReviewedVideo | null, after: ReviewedVideo): Promise<void> {
	if (!isVideoPubliclyVisible(after) || (before && isVideoPubliclyVisible(before))) return;
	await announceNewVideo(env as never, after as never).catch((error) =>
		logger.warn('[Review] Subscriber announcement failed after approval', { videoId: after.id, error: error instanceof Error ? error.message : String(error) }),
	);
}

/** Apply a write and return the before/after copies (null when nothing changed). */
async function write(
	env: ReviewApplyEnv,
	videoId: string,
	mutate: (video: ReviewedVideo) => { ok: true } | { ok: false; status: 404 | 409 | 400; why: string },
): Promise<{ before: ReviewedVideo; after: ReviewedVideo } | { error: { status: 404 | 409 | 400; why: string } }> {
	let before: ReviewedVideo | null = null;
	let refusal: { status: 404 | 409 | 400; why: string } | null = null;
	const saved = await repo(env).updateObject(videoId, (video) => {
		before = structuredClone(video);
		refusal = null;
		const verdict = mutate(video);
		if ('why' in verdict) {
			refusal = { status: verdict.status, why: verdict.why };
			return false;
		}
		const now = new Date().toISOString();
		markPublished(before, video, now);
		video.dateModified = now;
		return true;
	});
	if (refusal) return { error: refusal };
	if (!saved || !before) return { error: { status: 404, why: 'video not found' } };
	return { before, after: saved as ReviewedVideo };
}

function notice(video: ReviewedVideo, key: 'reviewApproved' | 'reviewRejected', extra: Record<string, string> = {}): NotificationCreatePayload | null {
	if (!video.userId || !video.review) return null;
	return {
		notificationId: crypto.randomUUID(),
		recipientUserId: video.userId,
		notificationKey: key,
		params: { videoTitle: video.title ?? '', ...extra },
		actionUrl: `/studio/video/${video.id}/edit`,
		entityId: video.id,
		// One notice per decision on a review, however often it is retried
		dedupeKey: `review:${video.review.reviewId}:${key}`,
		createdAt: Date.now(),
	};
}

type Transition = { ok: true } | { ok: false; status: 404 | 409 | 400; why: string };

/**
 * The automated result on a review state (videos and live stream recordings): approve clears a
 * `checking` review; a hold moves `checking` to a person, and pulls a public one (`post_review`,
 * `approved`) back only on an NSFW hit or an escalation (VR1, VR2, VR9). Mutates `review`.
 */
export function outcomeTransition(review: VideoReviewState | undefined, req: ReviewOutcomeRequest): Transition {
	if (!review || review.reviewId !== req.reviewId) return { ok: false, status: 409, why: 'not the current review' };
	const now = new Date().toISOString();
	if (req.routing.route === 'approve') {
		// Only the automated check's own state moves: a person's decision is never overridden
		if (review.status === 'checking') Object.assign(review, { status: 'approved', since: now });
		delete review.etaAt;
		return { ok: true };
	}
	// hold
	const pullBack = req.routing.nsfw || req.routing.escalate;
	if (review.status === 'checking' || (review.status === 'post_review' && pullBack) || (review.status === 'approved' && pullBack)) {
		Object.assign(review, { status: 'in_review', since: now, holdCause: req.routing.holdCause ?? 'risk' });
		delete review.etaAt;
	}
	// A trusted channel's non-NSFW risk stays public: a person reviews it post-hoc (VR1, VR2)
	return { ok: true };
}

/** A person's decision on a review state, including undo within REVIEW_UNDO_MINUTES. Mutates `review`. */
export function decisionTransition(review: VideoReviewState | undefined, req: ReviewDecisionRequest): Transition {
	if (!review || review.reviewId !== req.reviewId) return { ok: false, status: 409, why: 'not the current review' };
	const now = new Date().toISOString();
	if (req.decision === 'undo') {
		if (!review.decidedAt || !review.previousStatus) return { ok: false, status: 409, why: 'nothing to undo' };
		if (Date.now() - Date.parse(review.decidedAt) > REVIEW_UNDO_MINUTES * 60_000) return { ok: false, status: 409, why: 'the undo window has passed' };
		Object.assign(review, { status: review.previousStatus, since: now });
		delete review.previousStatus;
		delete review.decidedAt;
		delete review.reasonCode;
		return { ok: true };
	}
	if (!['in_review', 'appealed', 'post_review', 'checking'].includes(review.status)) return { ok: false, status: 409, why: `already ${review.status}` };
	review.previousStatus = review.status;
	review.decidedAt = req.decidedAt || now;
	review.since = now;
	delete review.etaAt;
	delete review.holdCause;
	if (req.decision === 'approve') {
		review.status = 'approved';
		delete review.reasonCode;
	} else {
		review.status = 'rejected';
		review.reasonCode = req.reasonCode;
	}
	return { ok: true };
}

/** The processor's automated result. Shadow results never reach the video (the caller skips them). */
export async function applyReviewOutcome(env: ReviewApplyEnv, videoId: string, req: ReviewOutcomeRequest): Promise<ApplyResult> {
	if (req.mode === 'shadow') return { applied: false, status: 400, why: 'shadow results are recorded only' };
	const res = await write(env, videoId, (video) => outcomeTransition(video.review, req));
	if ('error' in res) return { applied: false, ...(res as { error: { status: 404 | 409 | 400; why: string } }).error };
	await afterVisibilityChange(env, res.before, res.after);
	logger.info('[Review] Automated outcome applied', { videoId, reviewId: req.reviewId, route: req.routing.route, status: res.after.review?.status });
	return { applied: true, review: res.after.review as VideoReviewState };
}

/** A person's decision (admin-api, web or native), including undo within REVIEW_UNDO_MINUTES. */
export async function applyReviewDecision(env: ReviewApplyEnv, videoId: string, req: ReviewDecisionRequest): Promise<ApplyResult> {
	if (req.decision === 'reject' && !isReviewReasonCode(req.reasonCode)) return { applied: false, status: 400, why: 'a reason is required to reject' };
	const res = await write(env, videoId, (video) => decisionTransition(video.review, req));
	if ('error' in res) return { applied: false, ...(res as { error: { status: 404 | 409 | 400; why: string } }).error };
	await afterVisibilityChange(env, res.before, res.after);
	if (req.decision !== 'undo') {
		const payload = notice(res.after, req.decision === 'approve' ? 'reviewApproved' : 'reviewRejected', req.decision === 'reject' ? { reason: req.reasonCode ?? 'other' } : {});
		if (payload) await enqueueNotification(env, payload);
	}
	logger.info('[Review] Decision applied', { videoId, reviewId: req.reviewId, decision: req.decision, reviewerId: req.reviewerId });
	return { applied: true, review: res.after.review as VideoReviewState };
}

/** The creator appeals a rejection: once per review (VR10); a different reviewer decides. */
export async function appealReview(env: ReviewApplyEnv, videoId: string, message: string): Promise<ApplyResult> {
	const text = message.trim().slice(0, 2000);
	if (!text) return { applied: false, status: 400, why: 'say why the decision is wrong' };
	let rejectedId = '';
	const appealId = crypto.randomUUID();
	const res = await write(env, videoId, (video) => {
		const review = video.review;
		if (!review || review.status !== 'rejected') return { ok: false, status: 409, why: 'only a rejected video can be appealed' };
		if (review.appealUsed) return { ok: false, status: 409, why: 'this decision was already appealed' };
		rejectedId = review.reviewId;
		Object.assign(review, { status: 'appealed', reviewId: appealId, since: new Date().toISOString(), appealUsed: true, holdCause: 'appeal' });
		delete review.previousStatus;
		delete review.decidedAt;
		return { ok: true };
	});
	if ('error' in res) return { applied: false, ...(res as { error: { status: 404 | 409 | 400; why: string } }).error };
	const payload: VideoReviewAppealPayload = { videoId, reviewId: rejectedId, appealReviewId: appealId, ownerId: res.after.userId, channelId: res.after.channelId ?? undefined, message: text, at: new Date().toISOString() };
	await env.MODERATION_QUEUE?.send({ id: crypto.randomUUID(), type: MessageType.VideoReviewAppeal, payload, timestamp: Date.now() });
	logger.info('[Review] Appeal opened', { videoId, reviewId: rejectedId, appealReviewId: appealId });
	return { applied: true, review: res.after.review as VideoReviewState };
}

/** After editing a rejected video, the creator asks for a new check (a new review). */
export async function resubmitReview(env: ReviewApplyEnv, videoId: string): Promise<ApplyResult> {
	const res = await write(env, videoId, (video) => {
		const review = video.review;
		if (!review || review.status !== 'rejected') return { ok: false, status: 409, why: 'only a rejected video can be resubmitted' };
		const since = new Date();
		video.review = {
			status: 'checking',
			reviewId: crypto.randomUUID(),
			timing: 'pre',
			since: since.toISOString(),
			...(review.manifestKey ? { manifestKey: review.manifestKey } : {}),
		};
		return { ok: true };
	});
	if ('error' in res) return { applied: false, ...(res as { error: { status: 404 | 409 | 400; why: string } }).error };
	await queueReviewScan(env, videoId, { trigger: 'resubmit', manifestKey: res.after.review?.manifestKey });
	return { applied: true, review: res.after.review as VideoReviewState };
}
