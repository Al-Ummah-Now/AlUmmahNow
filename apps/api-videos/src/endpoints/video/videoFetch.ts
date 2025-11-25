import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import { transformVideoToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';

export class VideoFetch extends OpenAPIRoute {
	schema = {
		tags: ["Videos"],
		summary: "Get a single video by id",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
				userId: Str({ description: "User ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a single video if found",
				content: {
					"application/json": {
						schema: VideoView,
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

	async handle(c) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Retrieve the validated slug
		const { id } = request.params;
		const { channelId, userId } = request.headers;

		// Implement your own object fetch here
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		let video = await repository.getObject(id);

		const exists = video !== null;

		if (!exists) {
			return c.json(
				{
					success: false,
					error: "Object not found",
				},
				404
			);
		}

		// Check if video is deleted (soft delete)
		if (video.isDeleted) {
			logger.warn('[VideoFetch] Video is deleted', { videoId: id });
			return c.json(
				{
					success: false,
					error: "Object not found",
				},
				404
			);
		}

		// Check if video is hidden (moderation) - blocks everyone
		if (video.isHidden) {
			logger.warn('[VideoFetch] Video is hidden', { videoId: id });
			return c.json(
				{
					success: false,
					error: "Object not found",
				},
				404
			);
		}

		// Check privacy permissions
		if (video.isPublic === false && (!userId || video.userId !== userId)) {
			return c.json(
				{
					success: false,
					error: "Object not found", // Don't reveal that private video exists
				},
				404
			);
		}

		// Fetch channel data to populate channelName, channelAvatarUrl, and channelCoverUrl
		let channel = null;
		if (video.channelId) {
			try {
				const channelBucket = c.env.channels;
				type ChannelType = z.infer<typeof BusinessChannel>;
				const channelRepository = new R2Repository<ChannelType>(channelBucket);
				channel = await channelRepository.getObject(video.channelId);

				if (channel) {
					logger.info('[VideoFetch] Channel fetched successfully', {
						videoId: video.id,
						channelId: video.channelId,
						channelName: channel.name
					});
				} else {
					logger.warn('[VideoFetch] Channel not found', {
						videoId: video.id,
						channelId: video.channelId
					});
				}
			} catch (error) {
				logger.error('[VideoFetch] Error fetching channel data', {
					videoId: video.id,
					channelId: video.channelId,
					error: error instanceof Error ? error.message : String(error)
				});
				// Continue without channel data - transformation will use empty values
			}
		}

		// Transform to view model for response with channel data
		const videoView = transformVideoToView(video, channel);

		// Send queue message for video view analytics
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.VideoView, {
			videoId: video.id,
			userId,
			channelId,
			timestamp: new Date().toISOString(),
		});

		return videoView;
	}
}

