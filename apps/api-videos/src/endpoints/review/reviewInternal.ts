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
 * api-videos is the only writer of a video's `review` field; these are the only ways in.
 */
import { Hono } from 'hono';
import type { ImageReviewResultRequest, LiveVodReviewMediaRequest, ReviewDecisionRequest, ReviewOutcomeRequest } from '@al-ummah/shared-types';
import { applyLiveReviewDecision, applyLiveReviewMedia, applyLiveReviewOutcome, liveReviewSubject, type LiveReviewEnv } from '../../lib/review/live';
import { applyImageResult } from '../../lib/review/images';
import { logger } from '../../lib/logger';
import { applyReviewDecision, applyReviewOutcome, type ReviewApplyEnv } from '../../lib/review/apply';
import { queueReviewScan } from '../../lib/review/scan';

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

export function createReviewInternalRouter() {
	const app = new Hono<{ Bindings: ReviewApplyEnv }>();

	// Images (VR16): posts, avatars, banners, profile pictures; outcome = processor, decision = admin-api
	for (const kind of ['outcome', 'decision'] as const) {
		app.post(`/images/${kind}`, async (c) => {
			const body = (await c.req.json().catch(() => null)) as ImageReviewResultRequest | null;
			const allowed = kind === 'outcome' ? ['approve', 'hold'] : ['approve', 'reject'];
			if (!isObject(body) || typeof body.subjectId !== 'string' || typeof body.reviewId !== 'string' || !['post', 'avatar', 'banner', 'profile_picture', 'profile_banner'].includes(String(body.subject)) || !allowed.includes(String(body.result))) {
				return c.json({ success: false, error: `subject, subjectId, reviewId and result (${allowed.join(' | ')}) are required` }, 400);
			}
			const result = await applyImageResult(c.env as never, body);
			if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
			return c.json({ success: true, result: { applied: true } });
		});
	}

	// Live stream recordings (registered before /:videoId so "livestream" is never read as a video id)
	// The reviewer's view of a recording (admin-api review page): what it says and a playable URL
	app.get('/livestream/:id', async (c) => {
		const view = await liveReviewSubject(c.env as unknown as LiveReviewEnv, c.req.param('id'));
		if (!view) return c.json({ success: false, error: 'stream not found' }, 404);
		return c.json({ success: true, result: view });
	});

	app.post('/livestream/:id/media', async (c) => {
		const body = (await c.req.json().catch(() => null)) as LiveVodReviewMediaRequest | null;
		if (!isObject(body) || typeof body.reviewId !== 'string' || (body.manifestKey !== undefined && typeof body.manifestKey !== 'string') || (body.error !== undefined && typeof body.error !== 'string')) {
			return c.json({ success: false, error: 'reviewId is required; manifestKey and error are strings' }, 400);
		}
		const result = await applyLiveReviewMedia(c.env as unknown as LiveReviewEnv, c.req.param('id'), body);
		if (!result.queued) return c.json({ success: false, error: result.why ?? 'not queued' }, result.why === 'error' || result.why === 'moderation queue not bound' ? 503 : 409);
		return c.json({ success: true, result: { queued: true } });
	});

	app.post('/livestream/:id/outcome', async (c) => {
		const body = (await c.req.json().catch(() => null)) as ReviewOutcomeRequest | null;
		if (!isObject(body) || typeof body.reviewId !== 'string' || !isObject(body.routing) || !['approve', 'hold'].includes(String(body.routing.route))) {
			return c.json({ success: false, error: 'reviewId and routing.route (approve | hold) are required' }, 400);
		}
		const result = await applyLiveReviewOutcome(c.env as unknown as LiveReviewEnv, c.req.param('id'), body);
		if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
		return c.json({ success: true, result: { review: result.review } });
	});

	app.post('/livestream/:id/decision', async (c) => {
		const body = (await c.req.json().catch(() => null)) as ReviewDecisionRequest | null;
		if (!isObject(body) || typeof body.reviewId !== 'string' || typeof body.reviewerId !== 'string' || !['approve', 'reject', 'undo'].includes(String(body.decision))) {
			return c.json({ success: false, error: 'reviewId, reviewerId and decision (approve | reject | undo) are required' }, 400);
		}
		const result = await applyLiveReviewDecision(c.env as unknown as LiveReviewEnv, c.req.param('id'), body);
		if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
		return c.json({ success: true, result: { review: result.review } });
	});

	app.post('/:videoId/outcome', async (c) => {
		const body = (await c.req.json().catch(() => null)) as ReviewOutcomeRequest | null;
		if (!isObject(body) || typeof body.reviewId !== 'string' || !isObject(body.routing) || !['approve', 'hold'].includes(String(body.routing.route))) {
			return c.json({ success: false, error: 'reviewId and routing.route (approve | hold) are required' }, 400);
		}
		const result = await applyReviewOutcome(c.env, c.req.param('videoId'), body);
		if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
		return c.json({ success: true, result: { review: result.review } });
	});

	app.post('/:videoId/decision', async (c) => {
		const body = (await c.req.json().catch(() => null)) as ReviewDecisionRequest | null;
		if (!isObject(body) || typeof body.reviewId !== 'string' || typeof body.reviewerId !== 'string' || !['approve', 'reject', 'undo'].includes(String(body.decision))) {
			return c.json({ success: false, error: 'reviewId, reviewerId and decision (approve | reject | undo) are required' }, 400);
		}
		if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 1000)) return c.json({ success: false, error: 'note must be at most 1,000 characters' }, 400);
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
