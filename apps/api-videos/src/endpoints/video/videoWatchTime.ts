import { Str } from "chanfana";
import { z } from "zod";
import { OptionalAuthRoute, AppContext } from "../../base";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from "../../lib/logger";

/** Largest delta one report may carry (the player reports at least this often while playing). */
export const MAX_WATCH_TIME_DELTA_SECONDS = 60;

/**
 * POST /api/videos/:id/watch-time (#235)
 * Played seconds since the previous report for one playback session. Queues
 * MessageType.VideoWatchTime; the processor adds the seconds to the video and
 * channel rollups' watchTime (no view is counted). Reports are rate-limited per
 * (session, video) with the WATCH_TIME_LIMITER binding.
 */
export class VideoWatchTime extends OptionalAuthRoute {
	schema = {
		tags: ["Videos"],
		summary: "Report watch time",
		description: `🔓 **Authentication Optional**: Report played seconds (0 < seconds <= ${MAX_WATCH_TIME_DELTA_SECONDS}) since the previous report of this playback session. Rate-limited per session.`,
		request: {
			params: z.object({ id: Str({ description: "Video id" }) }),
			body: {
				content: {
					"application/json": {
						schema: z.object({
							seconds: z.number().positive().max(MAX_WATCH_TIME_DELTA_SECONDS).describe("Played seconds since the previous report"),
							sessionId: z.string().min(8).max(128).describe("Playback session id (one per player load)"),
						}),
					},
				},
			},
		},
		responses: {
			"202": {
				description: "Watch time accepted",
				content: { "application/json": { schema: z.object({ success: z.boolean() }) } },
			},
			"400": { description: "Invalid seconds or session", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Video not found", content: { "application/json": { schema: ResponseError } } },
			"429": { description: "Too many reports for this session", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id } = request.params;
		const { seconds, sessionId } = request.body;
		const userId = this.getUserId(c);

		if (c.env.WATCH_TIME_LIMITER) {
			try {
				const { success } = await c.env.WATCH_TIME_LIMITER.limit({ key: `${sessionId}:${id}` });
				if (!success) return c.json({ success: false, error: "Too many watch-time reports" }, 429);
			} catch (error) {
				// The limiter is a guard, not a dependency: never drop data because of it
				logger.warn("[watch-time] rate limiter unavailable", { error });
			}
		}

		type VideoType = z.infer<typeof BusinessVideo>;
		const video = await new R2Repository<VideoType>(c.env.videos).getObject(id);
		if (!video || (video.isPublic === false && (!userId || video.userId !== userId))) {
			return c.json({ success: false, error: "Video not found" }, 404);
		}

		await new Queue(c.env.queue).send(MessageType.VideoWatchTime, {
			videoId: id,
			videoChannelId: video.channelId ?? null,
			seconds: Math.round(seconds * 100) / 100,
			sessionId,
			viewerId: userId,
			timestamp: new Date().toISOString(),
		});

		return c.json({ success: true }, 202);
	}
}
