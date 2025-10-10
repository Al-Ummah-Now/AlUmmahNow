import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import { transformVideoToView } from "../../lib/transformations";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

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
		const bucket = env.videos;
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

		// Transform to view model for response
		const videoView = transformVideoToView(video);

		// Send queue message for video view analytics
		const queue = new Queue();
		await queue.send(MessageType.VideoView, { 
			videoId: video.id, 
			userId, 
			channelId,
			timestamp: new Date().toISOString(),
		});

		return videoView;
	}
}

