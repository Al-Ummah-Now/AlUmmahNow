/**
 * Review of an extra audio track (wiki AUN-MULTI-AUDIO MA8): the track's audio goes through the
 * uploads' checks (speech: transcription, text guard, Quran matcher) as subject `audio_track`, with
 * the uploads' state machine on `track.review` (outcomeTransition / decisionTransition).
 *
 * Flow: onTrackPrepared → MODERATION_QUEUE (subject audio_track, trackId) → processor →
 * applyAudioTrackOutcome; admin-api → applyAudioTrackDecision. A track that becomes audible is
 * packaged; one that is rejected leaves the package.
 */
import {
	MessageType,
	ORIGINAL_AUDIO_TRACK_ID,
	isAudibleTrack,
	isReviewReasonCode,
	readVideoReviewSettings,
	type AudioTrack,
	type ReviewDecisionRequest,
	type ReviewOutcomeRequest,
	type ReviewSettingsBucket,
	type VideoObject,
	type VideoReviewScanPayload,
	type VideoReviewState,
} from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { logger } from '../logger';
import { TAKEN, decisionTransition, outcomeTransition } from './apply';
import { reviewGateFor } from './gate';
import type { ReviewScanEnv } from './scan';
import type { AudioTracksEnv } from '../audio-tracks/service';

type Video = VideoObject & { audioTracks?: AudioTrack[] };
export type AudioTrackReviewEnv = ReviewScanEnv & AudioTracksEnv;
export type AudioTrackApplyResult = { applied: true; review: VideoReviewState } | { applied: false; status: 400 | 404 | 409; why: string };

const repo = (env: Pick<ReviewScanEnv, 'videos'>) => new R2Repository<Video>(env.videos);

/** Queue the processor's check of a track. Never throws (an enforced track then waits for a person). */
export async function queueAudioTrackScan(
	env: AudioTrackReviewEnv,
	video: Video,
	track: AudioTrack,
	opts: { reviewId: string; mode: 'shadow' | 'enforce' | 'enforce_nsfw'; manifestKey?: string; now?: Date; trigger?: 'upload' | 'metadata_edit' },
): Promise<{ queued: boolean; why?: string }> {
	try {
		if (!env.MODERATION_QUEUE) return { queued: false, why: 'moderation queue not bound' };
		const settings = await readVideoReviewSettings(env.global_settings as ReviewSettingsBucket | undefined);
		const now = opts.now ?? new Date();
		const payload: VideoReviewScanPayload = {
			videoId: video.id,
			trackId: track.id,
			reviewId: opts.reviewId,
			channelId: video.channelId ?? undefined,
			ownerId: video.userId,
			timing: track.review?.timing ?? 'pre',
			mode: opts.mode,
			// What the track says about itself, with the video's title for context
			metadataText: [track.label, video.title].filter((x) => typeof x === 'string' && x.trim()).join('\n').slice(0, 4000),
			...(opts.manifestKey ? { manifestKey: opts.manifestKey } : {}),
			// A changed name on a cleared track is checked again as text, like an edited video title
			trigger: opts.trigger ?? 'upload',
			subject: 'audio_track',
			settings,
			queuedAt: now.toISOString(),
		};
		if (opts.mode !== 'shadow') {
			await repo(env).updateObject(video.id, (fresh) => {
				const t = (fresh.audioTracks ?? []).find((x) => x.id === track.id);
				if (!t?.review || t.review.reviewId !== opts.reviewId) return false;
				t.review.scanQueuedAt = now.toISOString();
				return true;
			});
		}
		await env.MODERATION_QUEUE.send({ id: crypto.randomUUID(), type: MessageType.VideoReviewScan, payload, timestamp: now.getTime() });
		logger.info('[Review] Audio track scan queued', { videoId: video.id, trackId: track.id, mode: opts.mode, trigger: payload.trigger, partial: !opts.manifestKey });
		return { queued: true };
	} catch (error) {
		logger.error('[Review] Could not queue the audio track scan', { videoId: video.id, trackId: track.id, error: error instanceof Error ? error.message : String(error) });
		return { queued: false, why: 'error' };
	}
}

async function write(
	env: AudioTrackReviewEnv,
	videoId: string,
	trackId: string,
	mutate: (review: VideoReviewState | undefined) => { ok: true } | { ok: false; status: 404 | 409 | 400; why: string },
): Promise<AudioTrackApplyResult & { audibleBefore?: boolean; audibleAfter?: boolean }> {
	let refusal: { status: 404 | 409 | 400; why: string } | null = null;
	let before = false;
	let after = false;
	let review: VideoReviewState | undefined;
	const saved = await repo(env).updateObject(videoId, (fresh) => {
		refusal = null;
		const t = (fresh.audioTracks ?? []).find((x) => x.id === trackId);
		if (!t) {
			refusal = { status: 404, why: 'track not found' };
			return false;
		}
		before = isAudibleTrack(t);
		const verdict = (fresh as { csamTakedown?: unknown }).csamTakedown ? TAKEN : mutate(t.review);
		if ('why' in verdict) {
			refusal = { status: verdict.status, why: verdict.why };
			return false;
		}
		after = isAudibleTrack(t);
		// A default picked while the track waited moves once it can be heard
		const pending = t as AudioTrack & { pendingDefault?: boolean };
		if (after && pending.pendingDefault) {
			delete pending.pendingDefault;
			for (const x of fresh.audioTracks ?? []) x.isDefault = x.id === t.id;
		}
		// A rejected default gives the default back to the original
		if (!after && t.isDefault) {
			t.isDefault = false;
			const orig = (fresh.audioTracks ?? []).find((x) => x.id === ORIGINAL_AUDIO_TRACK_ID);
			if (orig) orig.isDefault = true;
		}
		t.updatedAt = new Date().toISOString();
		fresh.dateModified = t.updatedAt;
		review = t.review;
		return true;
	});
	if (refusal) return { applied: false, ...(refusal as { status: 404 | 409 | 400; why: string }) };
	if (!saved || !review) return { applied: false, status: 404, why: 'video not found' };
	return { applied: true, review, audibleBefore: before, audibleAfter: after };
}

async function repackageIfChanged(env: AudioTrackReviewEnv, videoId: string, trackId: string, res: { audibleBefore?: boolean; audibleAfter?: boolean }): Promise<void> {
	if (res.audibleBefore === res.audibleAfter) return;
	const { queueAudioPackage, withdrawPackagedTrack } = await import('../audio-tracks/service');
	// A track pulled back or rejected stops being served at once, before the rebuild lands
	if (res.audibleBefore && !res.audibleAfter) await withdrawPackagedTrack(env, videoId, trackId);
	await queueAudioPackage(env, undefined, videoId);
}

const strip = (r: AudioTrackApplyResult & { audibleBefore?: boolean; audibleAfter?: boolean }): AudioTrackApplyResult => (r.applied ? { applied: true, review: r.review } : r);

/** The processor's automated result (shadow results are recorded only). */
export async function applyAudioTrackOutcome(env: AudioTrackReviewEnv, videoId: string, trackId: string, req: ReviewOutcomeRequest): Promise<AudioTrackApplyResult> {
	if (req.mode === 'shadow') return { applied: false, status: 400, why: 'shadow results are recorded only' };
	const res = await write(env, videoId, trackId, (review) => outcomeTransition(review, req));
	if (res.applied) {
		logger.info('[Review] Audio track outcome applied', { videoId, trackId, reviewId: req.reviewId, route: req.routing.route, status: res.review.status });
		await repackageIfChanged(env, videoId, trackId, res);
		await recheckPendingLabel(env, videoId, trackId);
	}
	return strip(res);
}

/**
 * A name changed while the track was still checked: once the check has ended, a cleared track's
 * name gets its text check (metadata_edit), which can only pull it back. Never throws.
 */
export async function recheckPendingLabel(env: AudioTrackReviewEnv, videoId: string, trackId: string): Promise<void> {
	try {
		let due: AudioTrack | null = null;
		const saved = await repo(env).updateObject(videoId, (fresh) => {
			due = null;
			const t = (fresh.audioTracks ?? []).find((x) => x.id === trackId) as (AudioTrack & { labelCheckPending?: boolean }) | undefined;
			if (!t?.labelCheckPending || !t.review || t.review.status === 'checking') return false;
			delete t.labelCheckPending;
			if (t.review.status === 'approved' || t.review.status === 'post_review') due = t;
			return true;
		});
		const track = due as AudioTrack | null;
		if (!saved || !track) return;
		const gate = await reviewGateFor(env as never, saved);
		if (gate.mode !== 'enforce' && gate.mode !== 'enforce_nsfw') return;
		await queueAudioTrackScan(env, saved, track, { reviewId: track.review!.reviewId, mode: gate.mode, trigger: 'metadata_edit' });
	} catch (error) {
		logger.error('[Review] Could not re-check a track name', { videoId, trackId, error: error instanceof Error ? error.message : String(error) });
	}
}

/** A person's decision through admin-api (approve | reject | undo). */
export async function applyAudioTrackDecision(env: AudioTrackReviewEnv, videoId: string, trackId: string, req: ReviewDecisionRequest): Promise<AudioTrackApplyResult> {
	if (req.decision === 'reject' && !isReviewReasonCode(req.reasonCode)) return { applied: false, status: 400, why: 'a reason is required to reject' };
	const res = await write(env, videoId, trackId, (review) => decisionTransition(review, req));
	if (res.applied) {
		logger.info('[Review] Audio track decision applied', { videoId, trackId, reviewId: req.reviewId, decision: req.decision, reviewerId: req.reviewerId });
		await repackageIfChanged(env, videoId, trackId, res);
	}
	return strip(res);
}

/** The admin review page's view of a track: the video, the track and its review. */
export async function audioTrackReviewSubject(env: AudioTrackReviewEnv, videoId: string, trackId: string) {
	const video = await repo(env).getObject(videoId);
	const track = (video?.audioTracks ?? []).find((t) => t.id === trackId);
	if (!video || !track) return null;
	return {
		videoId,
		trackId,
		title: video.title ?? '',
		channelId: video.channelId ?? undefined,
		ownerId: video.userId,
		duration: track.durationSeconds,
		language: track.language,
		label: track.label,
		kind: track.kind,
		review: track.review ?? null,
		/** The reviewer's player streams the track through admin-api (audio/mp4) */
		audioPath: `/internal/review/audio-track/${encodeURIComponent(videoId)}/${encodeURIComponent(trackId)}/audio`,
	};
}
