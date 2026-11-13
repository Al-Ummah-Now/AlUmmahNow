/**
 * Post-hoc review of a live stream's recording (VR9, docs/specs/VIDEO-REVIEW.md §1.7).
 *
 * Live streams are never checked before they air. When a session's recording is ready (self-hosted
 * finalize or the Bunny VOD poll), the stream gets a `post_review` review: the recording plays as
 * usual while the media worker extracts frames and audio from the HLS VOD and the processor checks
 * it like an upload. Only an NSFW hit or an escalation pulls the recording back (`in_review`, owner
 * only); a reviewer then approves or rejects it. Shadow mode records a marker and changes nothing.
 *
 * Flow: startLiveVodReview → TRANSCODE_QUEUE (LiveReviewJobMessage) → media → applyLiveReviewMedia
 * → MODERATION_QUEUE (subject `livestream`) → processor → applyLiveReviewOutcome; admin-api →
 * applyLiveReviewDecision. Same state machine as videos (outcomeTransition / decisionTransition).
 */
import {
	MessageType,
	effectiveReviewMode,
	isReviewReasonCode,
	readVideoReviewSettings,
	scansInMode,
	type LiveReviewJobMessage,
	type LiveVodReviewMediaRequest,
	type NotificationCreatePayload,
	type ReviewDecisionRequest,
	type ReviewOutcomeRequest,
	type ReviewSettingsBucket,
	type VideoReviewScanPayload,
	type VideoReviewShadowMarker,
	type VideoReviewState,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import { enqueueNotification, type NotificationsEnv } from '../notifications';
import { streamKey, type LiveStreamRecord } from '../live/streams';
import { signLiveVodUrl, type VodSignEnv } from '../live/vod-sign';
import { decisionTransition, outcomeTransition } from './apply';
import { reviewExtractionFor, type ReviewScanEnv } from './scan';

export type LiveReviewEnv = ReviewScanEnv & VodSignEnv & NotificationsEnv & { TRANSCODE_QUEUE?: { send(message: unknown): Promise<unknown> } };

/** The review fields on a `livestream:{id}` record. */
export interface ReviewedStream extends LiveStreamRecord {
	review?: VideoReviewState;
	reviewShadow?: VideoReviewShadowMarker;
	/** The session whose recording the current review checks (one review per recording) */
	reviewSessionId?: string;
	description?: string;
	tags?: string[];
	thumbnailUrl?: string;
}

export type LiveApplyResult = { applied: true; review: VideoReviewState } | { applied: false; status: 404 | 409 | 400; why: string };

const repo = (env: Pick<ReviewScanEnv, 'videos'>) => new R2Repository<ReviewedStream>(env.videos);

const rev = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

function streamScanText(s: ReviewedStream): string {
	return [s.title, s.description, ...(Array.isArray(s.tags) ? s.tags : [])].filter((x) => typeof x === 'string' && x.trim()).join('\n').slice(0, 4000);
}

/**
 * The recording of `sessionId` is ready: start its review (once per session). Never throws; a
 * review that cannot start leaves the recording playing (live is never pre-reviewed) and logs it.
 */
export async function startLiveVodReview(env: LiveReviewEnv, streamId: string, session: { id: string; vod_url: string | null }, now = new Date()): Promise<{ started: boolean; why?: string }> {
	try {
		if (!session.vod_url) return { started: false, why: 'no recording' };
		const settings = await readVideoReviewSettings(env.global_settings as ReviewSettingsBucket | undefined);
		const mode = effectiveReviewMode(settings, env.VIDEO_REVIEW_ALLOWED);
		if (!scansInMode(mode)) return { started: false, why: 'review is off' };
		let reviewId = '';
		let why: string | undefined;
		const saved = await repo(env).updateObject(streamKey(streamId), (stream) => {
			why = undefined;
			if (stream.reviewSessionId === session.id) {
				why = 'already started';
				return false;
			}
			reviewId = crypto.randomUUID();
			stream.reviewSessionId = session.id;
			if (mode === 'shadow') {
				stream.reviewShadow = { reviewId, queuedAt: now.toISOString() };
			} else {
				// A new recording replaces the previous recording's review
				stream.review = { status: 'post_review', reviewId, timing: 'post', since: now.toISOString() };
			}
			stream.dateModified = now.toISOString();
			return true;
		});
		if (why || !saved) return { started: false, why: why ?? 'stream not found' };
		const review = await reviewExtractionFor(env);
		const vodUrl = await signLiveVodUrl(env, session.vod_url);
		if (env.TRANSCODE_QUEUE && review && vodUrl) {
			const job: LiveReviewJobMessage = { kind: 'live_review', streamId, reviewId, rev: rev(), vodUrl, review, queuedAt: now.toISOString() };
			try {
				await env.TRANSCODE_QUEUE.send(job);
				logger.info('[Review] Live recording review started', { streamId, sessionId: session.id, mode });
				return { started: true };
			} catch (error) {
				logger.warn('[Review] Could not queue the recording extraction; checking the title and thumbnail only', { streamId, error: error instanceof Error ? error.message : String(error) });
			}
		}
		// No media worker: the check runs on what the stream says about itself (partial)
		const queued = await queueLiveReviewScan(env, streamId, { reviewId, now });
		return queued.queued ? { started: true } : { started: false, why: queued.why };
	} catch (error) {
		logger.error('[Review] Could not start the recording review', { streamId, sessionId: session.id, error: error instanceof Error ? error.message : String(error) });
		return { started: false, why: 'error' };
	}
}

/** Queue the processor's check of the stream's current recording review. */
export async function queueLiveReviewScan(
	env: LiveReviewEnv,
	streamId: string,
	opts: { reviewId: string; manifestKey?: string; now?: Date },
): Promise<{ queued: boolean; why?: string }> {
	try {
		if (!env.MODERATION_QUEUE) return { queued: false, why: 'moderation queue not bound' };
		const settings = await readVideoReviewSettings(env.global_settings as ReviewSettingsBucket | undefined);
		const now = opts.now ?? new Date();
		let payload: VideoReviewScanPayload | null = null;
		let why: string | undefined;
		await repo(env).updateObject(streamKey(streamId), (stream) => {
			payload = null;
			why = undefined;
			const enforced = stream.review?.reviewId === opts.reviewId;
			const shadow = !enforced && stream.reviewShadow?.reviewId === opts.reviewId;
			if (!enforced && !shadow) {
				why = 'not the current review';
				return false;
			}
			if (enforced) {
				stream.review!.scanQueuedAt = now.toISOString();
				if (opts.manifestKey) stream.review!.manifestKey = opts.manifestKey;
			}
			payload = {
				videoId: streamId,
				reviewId: opts.reviewId,
				channelId: stream.channelId ?? undefined,
				ownerId: stream.userId,
				timing: 'post',
				// The mode the review started in: a stored review is enforced, a marker is shadow only
				mode: enforced ? 'enforce' : 'shadow',
				metadataText: streamScanText(stream),
				...(stream.thumbnailUrl ? { thumbnail: { url: stream.thumbnailUrl } } : {}),
				...(opts.manifestKey ? { manifestKey: opts.manifestKey } : {}),
				trigger: 'live_vod',
				subject: 'livestream',
				settings,
				queuedAt: now.toISOString(),
			};
			return true;
		});
		if (!payload) return { queued: false, why: why ?? 'stream not found' };
		const p = payload as VideoReviewScanPayload;
		await env.MODERATION_QUEUE.send({ id: crypto.randomUUID(), type: MessageType.VideoReviewScan, payload: p, timestamp: now.getTime() });
		logger.debug('[Review] Recording scan queued', { streamId, mode: p.mode, partial: !p.manifestKey });
		return { queued: true };
	} catch (error) {
		logger.error('[Review] Could not queue the recording scan', { streamId, error: error instanceof Error ? error.message : String(error) });
		return { queued: false, why: 'error' };
	}
}

/** The media worker's report: the review media are ready (or extraction failed: partial check). */
export async function applyLiveReviewMedia(env: LiveReviewEnv, streamId: string, req: LiveVodReviewMediaRequest): Promise<{ queued: boolean; why?: string }> {
	if (req.error) logger.warn('[Review] Recording extraction failed; checking the title and thumbnail only', { streamId, error: req.error.slice(0, 300) });
	return queueLiveReviewScan(env, streamId, { reviewId: req.reviewId, manifestKey: req.error ? undefined : req.manifestKey });
}

async function write(env: LiveReviewEnv, streamId: string, mutate: (s: ReviewedStream) => { ok: true } | { ok: false; status: 404 | 409 | 400; why: string }): Promise<LiveApplyResult & { stream?: ReviewedStream }> {
	let refusal: { status: 404 | 409 | 400; why: string } | null = null;
	const saved = await repo(env).updateObject(streamKey(streamId), (stream) => {
		refusal = null;
		const verdict = mutate(stream);
		if ('why' in verdict) {
			refusal = { status: verdict.status, why: verdict.why };
			return false;
		}
		stream.dateModified = new Date().toISOString();
		return true;
	});
	if (refusal) return { applied: false, ...(refusal as { status: 404 | 409 | 400; why: string }) };
	if (!saved?.review) return { applied: false, status: 404, why: 'stream not found' };
	return { applied: true, review: saved.review, stream: saved };
}

/** The processor's automated result on a recording (shadow results are recorded only). */
export async function applyLiveReviewOutcome(env: LiveReviewEnv, streamId: string, req: ReviewOutcomeRequest): Promise<LiveApplyResult> {
	if (req.mode === 'shadow') return { applied: false, status: 400, why: 'shadow results are recorded only' };
	const res = await write(env, streamId, (s) => outcomeTransition(s.review, req));
	if (res.applied) logger.info('[Review] Recording outcome applied', { streamId, reviewId: req.reviewId, route: req.routing.route, status: res.review.status });
	return strip(res);
}

/** A person's decision on a recording through admin-api (approve | reject | undo). */
export async function applyLiveReviewDecision(env: LiveReviewEnv, streamId: string, req: ReviewDecisionRequest): Promise<LiveApplyResult> {
	if (req.decision === 'reject' && !isReviewReasonCode(req.reasonCode)) return { applied: false, status: 400, why: 'a reason is required to reject' };
	const res = await write(env, streamId, (s) => decisionTransition(s.review, req));
	if (res.applied && res.stream && req.decision !== 'undo' && env.queue) {
		const payload = notice(res.stream, req);
		if (payload) await enqueueNotification(env, payload);
	}
	if (res.applied) logger.info('[Review] Recording decision applied', { streamId, reviewId: req.reviewId, decision: req.decision, reviewerId: req.reviewerId });
	return strip(res);
}

function strip(res: LiveApplyResult & { stream?: ReviewedStream }): LiveApplyResult {
	const { stream: _s, ...rest } = res;
	return rest as LiveApplyResult;
}

/** The owner hears about a person's decision, like a video's (one notice per decision). */
function notice(stream: ReviewedStream, req: ReviewDecisionRequest): NotificationCreatePayload | null {
	if (!stream.userId || !stream.review) return null;
	const key = req.decision === 'approve' ? 'reviewApproved' : 'reviewRejected';
	return {
		notificationId: crypto.randomUUID(),
		recipientUserId: stream.userId,
		notificationKey: key,
		params: { videoTitle: stream.title ?? '', ...(req.decision === 'reject' ? { reason: req.reasonCode ?? 'other' } : {}) },
		actionUrl: stream.channelId ? `/studio/${stream.channelId}/content/live/${stream.id}` : '/studio',
		entityId: stream.id,
		dedupeKey: `review:${stream.review.reviewId}:${key}`,
		createdAt: Date.now(),
	};
}

/** The admin review page's view of a recording: what the stream says, its review and a playable (signed) URL. */
export async function liveReviewSubject(env: LiveReviewEnv, streamId: string) {
	const s = await repo(env).getObject(streamKey(streamId));
	if (!s) return null;
	const duration = s.actualStartTime && s.actualEndTime ? Math.max(0, Math.round((Date.parse(s.actualEndTime) - Date.parse(s.actualStartTime)) / 1000)) : undefined;
	return {
		id: s.id,
		title: s.title ?? '',
		description: s.description ?? '',
		tags: Array.isArray(s.tags) ? s.tags : [],
		channelId: s.channelId ?? undefined,
		ownerId: s.userId,
		duration,
		status: s.status,
		review: s.review ?? null,
		playUrl: await signLiveVodUrl(env, s.vodUrl ?? null),
		thumbnailUrl: s.thumbnailUrl ?? null,
	};
}
