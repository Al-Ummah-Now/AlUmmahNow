/**
 * The creator's side of pre-publication review (docs/specs/VIDEO-REVIEW.md §3, VR10):
 * - POST /api/videos/:id/review/appeal    { message }: once per rejection; a different reviewer decides
 * - POST /api/videos/:id/review/resubmit  after editing a rejected video: a new automated check
 *
 * Allowed for the owner and channel members who may edit the video (video.edit).
 */
import { Str } from 'chanfana';
import { z } from 'zod';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { ResponseError } from '../../lib/types';
import R2Repository from '../../lib/r2Repo';
import { canOnVideo } from '../../lib/channelAccess';
import { appealReview, resubmitReview, type ReviewApplyEnv } from '../../lib/review/apply';

const ReviewState = z.object({
	status: z.enum(['checking', 'in_review', 'approved', 'rejected', 'appealed', 'post_review']),
	reviewId: z.string(),
	since: z.string(),
	etaAt: z.string().optional(),
	reasonCode: z.string().optional(),
	appealUsed: z.boolean().optional(),
});

const responses = {
	'200': { description: 'The new review state', content: { 'application/json': { schema: z.object({ success: z.boolean(), result: z.object({ review: ReviewState }) }) } } },
	'400': { description: 'Invalid request', content: { 'application/json': { schema: ResponseError } } },
	'404': { description: 'Video not found', content: { 'application/json': { schema: ResponseError } } },
	'409': { description: 'Not possible in the current review state', content: { 'application/json': { schema: ResponseError } } },
};

async function authorize(c: AppContext, id: string, userId: string | null | undefined): Promise<boolean> {
	const video = await new R2Repository<{ id: string; userId?: string; channelId?: string; isDeleted?: boolean }>(c.env.videos).getObject(id);
	if (!video || video.isDeleted) return false;
	return canOnVideo(c.env as never, video, userId, 'video.edit');
}

export class VideoReviewAppeal extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Videos'],
			summary: 'Appeal a review decision',
			description: 'Asks a different reviewer to look again at a video that was not approved. Once per decision.',
			request: {
				params: z.object({ id: Str({ description: 'Video ID' }) }),
				body: { content: { 'application/json': { schema: z.object({ message: z.string().min(1).max(2000) }) } } },
			},
			responses,
		},
		'required',
	);

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		if (!(await authorize(c, data.params.id, this.getUserId(c)))) return c.json({ success: false, error: 'Video not found' }, 404);
		const result = await appealReview(c.env as unknown as ReviewApplyEnv, data.params.id, data.body.message);
		if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
		return c.json({ success: true, result: { review: result.review } });
	}
}

export class VideoReviewResubmit extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Videos'],
			summary: 'Check a video again after editing it',
			description: 'Starts a new automated check of a video that was not approved, after the creator edited it.',
			request: { params: z.object({ id: Str({ description: 'Video ID' }) }) },
			responses,
		},
		'required',
	);

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		if (!(await authorize(c, data.params.id, this.getUserId(c)))) return c.json({ success: false, error: 'Video not found' }, 404);
		const result = await resubmitReview(c.env as unknown as ReviewApplyEnv, data.params.id);
		if ('why' in result) return c.json({ success: false, error: result.why }, result.status);
		return c.json({ success: true, result: { review: result.review } });
	}
}
