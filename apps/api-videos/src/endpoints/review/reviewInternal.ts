/**
 * Internal review endpoints (X-API-Key = INTERNAL_API_KEY; docs/specs/VIDEO-REVIEW.md §3).
 *
 * - POST /internal/review/:videoId/outcome   the processor's automated result (ReviewOutcomeRequest)
 * - POST /internal/review/:videoId/decision  a person's decision through admin-api (ReviewDecisionRequest)
 * - POST /internal/review/:videoId/scan      check again (admin "Run the check again"): a new scan of the current review
 * - GET  /internal/review/livestream/:id  the recording for the admin review page (signed playlist)
 * - POST /internal/review/livestream/:id/{media,outcome,decision}  a live stream's recording (VR9):
 *   the media worker's extraction result, the processor's result and a person's decision
 *
 * - GET  /internal/review/audio-track/:videoId/:trackId[/audio]  an audio track for the admin review page (wiki AUN-MULTI-AUDIO)
 * - POST /internal/review/audio-track/:videoId/:trackId/{outcome,decision}
 *
 * api-videos is the only writer of a video's `review` field; these are the only ways in.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { RecordId } from '../../validation/identifiers';
import { ObjectKey } from '../../validation/legacy-request';
import { applyLiveReviewDecision, applyLiveReviewMedia, applyLiveReviewOutcome, liveReviewSubject, type LiveReviewEnv } from '../../lib/review/live';
import { applyImageResult } from '../../lib/review/images';
import { logger } from '../../lib/logger';
import { applyReviewDecision, applyReviewOutcome, type ReviewApplyEnv } from '../../lib/review/apply';
import { queueReviewScan } from '../../lib/review/scan';
import { applyAudioTrackDecision, applyAudioTrackOutcome, audioTrackReviewSubject } from '../../lib/review/audio-track';
import { audioTrackFileKey, isAudioTrackId, isReviewReasonCode } from '@al-ummah/shared-types';

const ReasonCode = z.custom<import('@al-ummah/shared-types').VideoReviewReasonCode>(isReviewReasonCode);
const Outcome = z.object({
	reviewId: RecordId, mode: z.enum(['shadow', 'enforce_nsfw', 'enforce']), timing: z.enum(['pre', 'post']),
	routing: z.object({
		route: z.enum(['approve', 'hold']), risk: z.number().min(0).max(1), nsfw: z.boolean(), escalate: z.boolean(),
		holdCause: z.enum(['nsfw', 'risk', 'escalation', 'check_failed', 'budget', 'appeal']).optional(),
	}),
	findingsCount: z.number().int().nonnegative(), checkedAt: z.iso.datetime({ offset: true }),
});
const Decision = z.object({
	reviewId: RecordId, reviewerId: RecordId, decision: z.enum(['approve', 'reject', 'undo']),
	reasonCode: ReasonCode.optional(), note: z.string().max(1000).optional(), decidedAt: z.iso.datetime({ offset: true }).default(() => new Date().toISOString()),
});
const ImageResult = z.object({
	subject: z.enum(['post', 'avatar', 'banner', 'profile_picture', 'profile_banner']),
	subjectId: RecordId, reviewId: RecordId, result: z.enum(['approve', 'hold', 'reject']),
	reviewerId: RecordId.optional(), reasonCode: ReasonCode.optional(),
});
const LiveMedia = z.object({ reviewId: RecordId, manifestKey: z.string().max(512).optional(), error: z.string().max(500).optional() });

export function createReviewInternalRouter() {
	const app = new Hono<{ Bindings: ReviewApplyEnv }>();

	// Images (VR16): posts, avatars, banners, profile pictures; outcome = processor, decision = admin-api
	for (const kind of ['outcome', 'decision'] as const) {
		app.post(`/images/${kind}`, async (c) => {
			const parsed = ImageResult.safeParse(await c.req.json().catch(() => null));
			const allowed = kind === 'outcome' ? ['approve', 'hold'] : ['approve', 'reject'];
			if (!parsed.success || !allowed.includes(parsed.data.result)) {
				return c.json({ success: false, error: 'Invalid image review result' }, 400);
			}
			const body = parsed.data;
			const result = await applyImageResult(c.env as never, body);
			if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
			return c.json({ success: true, result: { applied: true } });
		});
	}

	// Audio tracks (wiki AUN-MULTI-AUDIO MA8; registered before /:videoId)
	app.get('/audio-track/:videoId/:trackId', async (c) => {
		const view = await audioTrackReviewSubject(c.env as never, c.req.param('videoId'), c.req.param('trackId'));
		if (!view) return c.json({ success: false, error: 'track not found' }, 404);
		return c.json({ success: true, result: view });
	});

	// The reviewer's player: the normalised track file (Range passed through)
	app.get('/audio-track/:videoId/:trackId/audio', async (c) => {
		const videoId = c.req.param('videoId');
		const trackId = c.req.param('trackId');
		const bucket = (c.env as unknown as { MEDIA_ORIGINALS?: R2Bucket }).MEDIA_ORIGINALS;
		if (!bucket || !isAudioTrackId(trackId) || !/^[A-Za-z0-9_-]{1,80}$/.test(videoId)) return c.json({ success: false, error: 'not found' }, 404);
		const range = c.req.header('range');
		const obj = await bucket.get(audioTrackFileKey(videoId, trackId), range ? { range: c.req.raw.headers } : undefined);
		if (!obj) return c.json({ success: false, error: 'not found' }, 404);
		const headers = new Headers({ 'content-type': 'audio/mp4', 'accept-ranges': 'bytes', 'cache-control': 'private, no-store' });
		const r = (obj as R2ObjectBody & { range?: { offset?: number; length?: number } }).range;
		if (range && r && (r.offset !== undefined || r.length !== undefined)) {
			const offset = r.offset ?? 0;
			const length = r.length ?? obj.size - offset;
			headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
			headers.set('content-length', String(length));
			return new Response((obj as R2ObjectBody).body, { status: 206, headers });
		}
		headers.set('content-length', String(obj.size));
		return new Response((obj as R2ObjectBody).body, { status: 200, headers });
	});

	app.post('/audio-track/:videoId/:trackId/outcome', async (c) => {
		const parsed = Outcome.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success || !RecordId.safeParse(c.req.param('videoId')).success || !isAudioTrackId(c.req.param('trackId'))) {
			return c.json({ success: false, error: 'Invalid review outcome or routing' }, 400);
		}
		const body = parsed.data;
		const result = await applyAudioTrackOutcome(c.env as never, c.req.param('videoId'), c.req.param('trackId'), body);
		if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
		return c.json({ success: true, result: { review: result.review } });
	});

	app.post('/audio-track/:videoId/:trackId/decision', async (c) => {
		const parsed = Decision.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success || !RecordId.safeParse(c.req.param('videoId')).success || !isAudioTrackId(c.req.param('trackId'))) {
			return c.json({ success: false, error: 'Invalid review decision' }, 400);
		}
		const body = parsed.data;
		const result = await applyAudioTrackDecision(c.env as never, c.req.param('videoId'), c.req.param('trackId'), body);
		if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
		return c.json({ success: true, result: { review: result.review } });
	});

	// Live stream recordings (registered before /:videoId so "livestream" is never read as a video id)
	// The reviewer's view of a recording (admin-api review page): what it says and a playable URL
	app.get('/livestream/:id', async (c) => {
		const view = await liveReviewSubject(c.env as unknown as LiveReviewEnv, c.req.param('id'));
		if (!view) return c.json({ success: false, error: 'stream not found' }, 404);
		return c.json({ success: true, result: view });
	});

	app.post('/livestream/:id/media', async (c) => {
		const parsed = LiveMedia.safeParse(await c.req.json().catch(() => null));
		const id = c.req.param('id');
		if (!parsed.success || !RecordId.safeParse(id).success) return c.json({ success: false, error: 'Invalid review media report' }, 400);
		const body = parsed.data;
		// Failed extraction can report a partial key. Only a successful report supplies a key to the consumer.
		if (!body.error && body.manifestKey !== undefined &&
			(!ObjectKey.safeParse(body.manifestKey).success || !body.manifestKey.startsWith('review/' + id + '/') || !body.manifestKey.endsWith('/manifest.json'))) {
			return c.json({ success: false, error: 'Invalid review manifest key' }, 400);
		}
		const result = await applyLiveReviewMedia(c.env as unknown as LiveReviewEnv, c.req.param('id'), body);
		if (!result.queued) return c.json({ success: false, error: result.why ?? 'not queued' }, result.why === 'error' || result.why === 'moderation queue not bound' ? 503 : 409);
		return c.json({ success: true, result: { queued: true } });
	});

	app.post('/livestream/:id/outcome', async (c) => {
		const parsed = Outcome.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success || !RecordId.safeParse(c.req.param('id')).success) {
			return c.json({ success: false, error: 'Invalid review outcome or routing' }, 400);
		}
		const body = parsed.data;
		const result = await applyLiveReviewOutcome(c.env as unknown as LiveReviewEnv, c.req.param('id'), body);
		if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
		return c.json({ success: true, result: { review: result.review } });
	});

	app.post('/livestream/:id/decision', async (c) => {
		const parsed = Decision.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success || !RecordId.safeParse(c.req.param('id')).success) {
			return c.json({ success: false, error: 'Invalid review decision' }, 400);
		}
		const body = parsed.data;
		const result = await applyLiveReviewDecision(c.env as unknown as LiveReviewEnv, c.req.param('id'), body);
		if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
		return c.json({ success: true, result: { review: result.review } });
	});

	app.post('/:videoId/outcome', async (c) => {
		const parsed = Outcome.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success || !RecordId.safeParse(c.req.param('videoId')).success) {
			return c.json({ success: false, error: 'Invalid review outcome or routing' }, 400);
		}
		const body = parsed.data;
		const result = await applyReviewOutcome(c.env, c.req.param('videoId'), body);
		if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
		return c.json({ success: true, result: { review: result.review } });
	});

	app.post('/:videoId/decision', async (c) => {
		const parsed = Decision.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success || !RecordId.safeParse(c.req.param('videoId')).success) {
			return c.json({ success: false, error: 'Invalid review decision' }, 400);
		}
		const body = parsed.data;
		const result = await applyReviewDecision(c.env, c.req.param('videoId'), body);
		if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
		return c.json({ success: true, result: { review: result.review } });
	});

	app.post('/:videoId/scan', async (c) => {
		const videoId = c.req.param('videoId');
		const result = await queueReviewScan(c.env, videoId, { trigger: 'upload', force: true });
		logger.info('[Review] Check queued again by an admin', { videoId, queued: result.queued, why: result.why });
		if (!result.queued) return c.json({ success: false, error: result.why ?? 'not queued' }, 409);
		return c.json({ success: true, result: { queued: true } });
	});

	return app;
}
