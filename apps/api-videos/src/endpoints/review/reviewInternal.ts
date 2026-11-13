/**
 * Internal review endpoints (X-API-Key = INTERNAL_API_KEY; docs/specs/VIDEO-REVIEW.md §3).
 *
 * - POST /internal/review/:videoId/outcome   the processor's automated result (ReviewOutcomeRequest)
 * - POST /internal/review/:videoId/decision  a person's decision through admin-api (ReviewDecisionRequest)
 * - POST /internal/review/:videoId/scan      check again (admin "Run the check again"): a new scan of the current review
 *
 * api-videos is the only writer of a video's `review` field; these are the only ways in.
 */
import { Hono } from 'hono';
import type { ImageReviewResultRequest, ReviewDecisionRequest, ReviewOutcomeRequest } from '@al-ummah/shared-types';
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
