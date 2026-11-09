import { Str } from "chanfana";
import { z } from "zod";
import { RETENTION_BUCKET_COUNT } from "@al-ummah/shared-types";
import { OptionalAuthRoute, AppContext } from "../../base";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from "../../lib/logger";
import { isVideoRemoved } from "../../lib/visibility";

/**
 * POST /api/videos/:id/retention
 * The retention buckets (5% of the video each) one playback session newly
 * reached. Queues MessageType.VideoRetention; the processor adds them to the
 * video's retention document (docs/specs/CREATOR-STUDIO.md §8.4). Reports share
 * the WATCH_TIME_LIMITER binding under their own key.
 */
export class VideoRetention extends OptionalAuthRoute {
	schema = {
		tags: ["Videos"],
		summary: "Report retention buckets",
		description: "🔓 **Authentication Optional**: Report the retention buckets one playback session newly reached.",
		request: {
			params: z.object({ id: Str({ description: "Video id" }) }),
			body: {
				content: {
					"application/json": {
						schema: z.object({
							buckets: z.array(z.number().int().min(0).max(RETENTION_BUCKET_COUNT - 1)).min(1).max(RETENTION_BUCKET_COUNT).describe("Buckets newly reached by this session"),
							sessionId: z.string().min(8).max(128).describe("Playback session id (one per player load)"),
						}),
					},
				},
			},
		},
		responses: {
			"202": {
				description: "Report accepted",
				content: { "application/json": { schema: z.object({ success: z.boolean() }) } },
			},
			"400": { description: "Invalid buckets or session", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Video not found", content: { "application/json": { schema: ResponseError } } },
			"429": { description: "Too many reports for this session", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id } = request.params;
		const { buckets, sessionId } = request.body;
		const userId = this.getUserId(c);

		if (c.env.WATCH_TIME_LIMITER) {
			try {
				const { success } = await c.env.WATCH_TIME_LIMITER.limit({ key: `retention:${sessionId}:${id}` });
				if (!success) return c.json({ success: false, error: "Too many retention reports" }, 429);
			} catch (error) {
				// The limiter is a guard, not a dependency: never drop data because of it
				logger.warn("[retention] rate limiter unavailable", { error });
			}
		}

		type VideoType = z.infer<typeof BusinessVideo>;
		const video = await new R2Repository<VideoType>(c.env.videos).getObject(id);
		if (!video || isVideoRemoved(video) || (video.isPublic === false && (!userId || video.userId !== userId))) {
			return c.json({ success: false, error: "Video not found" }, 404);
		}

		await new Queue(c.env.queue).send(MessageType.VideoRetention, {
			videoId: id,
			buckets,
			sessionId,
			timestamp: new Date().toISOString(),
		});

		return c.json({ success: true }, 202);
	}
}
