import { Str } from "chanfana";
import { z } from "zod";
import { PLAYBACK_FALLBACK_REASONS } from "@al-ummah/shared-types";
import { OptionalAuthRoute, AppContext } from "../../base";
import { canOnVideo } from "../../lib/channelAccess";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { transformVideoToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import { logger } from "../../lib/logger";
import { applyPlayback, choosePlayback, countFallback, logDecision, parseFallbackReason } from "../../lib/media/playback";

/**
 * GET /api/videos/:id/playback?exclude=r2&reason=<code>
 *
 * The player's one way out when the URL it was given (R2) fails: the API decides again without R2,
 * logs the decision with the player's reason, counts it, and returns the Bunny URL to play.
 * Same visibility rules as GET /api/videos/:id (private, hidden and deleted videos are 404).
 */
export class VideoPlayback extends OptionalAuthRoute {
	schema = {
		tags: ["Videos"],
		summary: "Playback URL without a failed source",
		description:
			"🔓 **Authentication Optional**: The one URL to play when the source the API chose failed in the player. " +
			"`exclude=r2` returns Bunny's URL; `reason` (the player's error class) is logged and counted.",
		request: {
			params: z.object({ id: Str({ description: "Video id" }) }),
			query: z.object({
				exclude: z.enum(["r2"]).describe("The source that failed"),
				reason: z.string().max(32).optional().describe(`Why: ${PLAYBACK_FALLBACK_REASONS.join(", ")} (anything else counts as other)`),
			}),
		},
		responses: {
			"200": {
				description: "The URL to play",
				content: {
					"application/json": {
						schema: z.object({
							id: z.string(),
							playUrl: z.string().optional(),
							thumbnailUrl: z.string().optional(),
							delivery: z.object({ source: z.enum(["bunny", "r2"]) }),
						}),
					},
				},
			},
			"404": { description: "Video not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id } = request.params;
		const reason = parseFallbackReason(request.query.reason);
		const userId = this.getUserId(c);

		const notFound = () => c.json({ success: false, error: "Object not found" }, 404);
		const repository = new R2Repository<z.infer<typeof BusinessVideo>>(c.env.videos);
		const video = await repository.getObject(id);
		if (!video || video.isDeleted || video.isHidden) return notFound();
		if (video.isPublic === false && !(await canOnVideo(c.env as never, video, userId, 'video.view_private'))) return notFound();

		const choice = await choosePlayback(c.env as never, video as never, { exclude: request.query.exclude, reason, context: "fallback" });
		logDecision(choice.decision);
		// The answer is never refused (a player is waiting on it); only the count is rate limited
		let count = true;
		if (c.env.WATCH_TIME_LIMITER) {
			try {
				count = (await c.env.WATCH_TIME_LIMITER.limit({ key: `playback-fallback:${id}` })).success;
			} catch (error) {
				logger.warn("[playback] rate limiter unavailable", { error });
			}
		}
		if (count) {
			const write = countFallback(c.env as never, { day: new Date().toISOString().slice(0, 10), requested: "r2", actual: choice.source, reason, column: "server_fallbacks" });
			try {
				c.executionCtx.waitUntil(write);
			} catch {
				await write;
			}
		}

		const view = applyPlayback(transformVideoToView(video), choice);
		c.header("Cache-Control", "private, no-store");
		// `id` lets the URL-signing middleware sign Bunny's URLs for this video
		return { id: view.id, playUrl: view.playUrl, thumbnailUrl: view.thumbnailUrl, delivery: view.delivery };
	}
}
