import { OpenAPIRoute, Str } from "chanfana";
import { OptionalAuthRoute, AppContext } from '../../base';
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { broadcastInBackground } from "../../lib/websocket-notify";
import { isVideoRemoved } from "../../lib/visibility";
import { normalizeEmbedOrigin } from "../../lib/embed-origin";

export class VideoView extends OptionalAuthRoute {
	schema = {
		tags: ["Videos"],
		summary: "Track Video View",
		description: "🔓 **Authentication Optional**: Track a video view for analytics. Increments view count and records analytics data.",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			body: {
				content: {
					"application/json": {
						schema: z.object({
							watchTime: z.number().optional().describe("How long the user watched the video in seconds"),
							quality: z.string().optional().describe("Video quality setting (e.g., '720p', '1080p')"),
							referrer: z.string().optional().describe("Where the user came from (e.g., 'search', 'channel', 'recommendation')"),
							deviceType: z.enum(["desktop", "mobile", "tablet", "tv"]).optional().describe("Type of device used"),
							source: z.enum(["watch", "embed"]).optional().describe("Playback surface: the watch page (default) or the embed player on another site"),
							embedOrigin: z.string().max(300).optional().describe("Embed only: origin of the page that embeds the player (never a path)"),
							location: z.object({
								country: z.string().optional(),
								region: z.string().optional(),
								city: z.string().optional(),
							}).optional().describe("User location data (if available)"),
						}),
					},
				},
			},
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "View tracked successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								viewCount: z.number(),
								message: z.string(),
							}),
						}),
					},
				},
			},
			"404": {
				description: "Video not found",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"400": {
				description: "Bad request - invalid input data",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"500": {
				description: "Internal server error",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		const { id } = request.params;
		// Get auth context for user information
		const userId = this.getUserId(c);
		const { channelId } = request.headers;
		const viewData = request.body;

		// Get video from storage
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		const video = await repository.getObject(id);

		// Deleted and moderation-hidden videos never count a view (embeds of removed videos included)
		if (!video || isVideoRemoved(video)) {
			return c.json({
				success: false,
				error: "Video not found",
			}, 404);
		}

		// Check privacy permissions
		if (video.isPublic === false && (!userId || video.userId !== userId)) {
			return c.json({
				success: false,
				error: "Video not found", // Don't reveal that private video exists
			}, 404);
		}

		// Update view count
		const updatedVideo = {
			...video,
			views: (video.views || 0) + 1,
			dateModified: new Date().toISOString(),
		};

		// Save updated video
		await repository.putObject(id, updatedVideo);

		// Push the new count to everyone watching this video (non-blocking)
		broadcastInBackground(c, `video:${id}`, 'view_count_updated', {
			videoId: id,
			viewCount: updatedVideo.views,
		});

		// Send detailed analytics event
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.VideoView, {
			videoId: id,
			videoTitle: video.title,
			videoOwnerId: video.userId,
			// Always present (null for legacy videos): the processor uses the key and
			// trackedView to tell counted views from fetch/search telemetry
			videoChannelId: video.channelId ?? null,
			trackedView: true,
			viewerId: userId,
			viewerChannelId: channelId,
			watchTime: viewData.watchTime,
			quality: viewData.quality,
			referrer: viewData.referrer,
			// docs/embeds §6: the processor rolls these into per-day source / embed-origin counts
			source: viewData.source === "embed" ? "embed" : "watch",
			embedOrigin: viewData.source === "embed" ? normalizeEmbedOrigin(viewData.embedOrigin) : null,
			deviceType: viewData.deviceType,
			location: viewData.location,
			timestamp: new Date().toISOString(),
			sessionId: crypto.randomUUID(), // Generate unique session ID for this view
		});

		return {
			success: true,
			result: {
				viewCount: updatedVideo.views,
				message: "View tracked successfully",
			},
		};
	}
}
