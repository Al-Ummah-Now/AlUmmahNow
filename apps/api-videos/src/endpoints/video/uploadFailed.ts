import { Str } from "chanfana";
import { z } from "zod";
import { AuthenticatedRoute, AppContext } from '../../base';
import { ResponseError } from "../../lib/types";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { rethrowBusy } from "../../lib/r2Repo";
import { flagNeedsReupload } from "../../lib/uploads/lifecycle";
import { logger } from '../../lib/logger';

/**
 * The uploader's browser gave up on an upload it cannot finish (after every
 * retry and re-authorisation). The video is flagged `needs_reupload`: the
 * uploader is notified and sees a Re-upload action, and admins see it in the
 * processing-health view. Idempotent; a finished video is never flagged.
 */
export class UploadFailedEndpoint extends AuthenticatedRoute {
	schema = addAuthToSchema({
		tags: ["Videos"],
		summary: "Report an upload that cannot finish",
		description: "Flags the caller's unfinished upload as needing a re-upload (uploader notification, Re-upload action, admin processing-health view). Idempotent. A finished video answers 409.",
		request: {
			params: z.object({
				videoId: Str({ description: "Video whose upload failed" }),
			}),
			body: {
				content: {
					"application/json": {
						schema: z.object({
							reason: z.string().max(500).optional().describe("What failed, shown to the uploader and admins"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Flagged (or already flagged)",
				content: { "application/json": { schema: z.object({ success: z.boolean(), result: z.object({ videoId: z.string(), status: z.string() }) }) } },
			},
			"403": { description: "Not the caller's video", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Video not found", content: { "application/json": { schema: ResponseError } } },
			"409": { description: "The upload already finished", content: { "application/json": { schema: ResponseError } } },
		},
	}, 'required');

	async handle(c: AppContext) {
		const userId = this.getUserId(c);
		const request = await this.getValidatedData<typeof this.schema>();
		const videoId = request.params.videoId;
		const reason = request.body?.reason?.trim() || 'The upload could not be completed. Upload the video file again.';
		try {
			const result = await flagNeedsReupload(c.env as never, videoId, { reason, source: 'client', ownerId: userId });
			if (result === 'missing') return c.json({ success: false, error: 'Video not found' }, 404);
			if (result === 'forbidden') return c.json({ success: false, error: 'Forbidden - not your video' }, 403);
			if (result === 'finished') return c.json({ success: false, error: 'The upload already finished' }, 409);
			return c.json({ success: true, result: { videoId, status: result } });
		} catch (error) {
			rethrowBusy(error);
			logger.error('[UploadFailed] Could not flag the upload', { videoId, error: error instanceof Error ? error.message : String(error) });
			c.header('Retry-After', '5');
			return c.json({ success: false, error: 'Could not record the failure, retry' }, 503);
		}
	}
}
