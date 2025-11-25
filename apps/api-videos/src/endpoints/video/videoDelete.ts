import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class VideoDelete extends OpenAPIRoute {
	schema = {
		tags: ["Videos"],
		summary: "Delete a Video",
		request: {
			params: z.object({
				videoId: Str({ description: "Video id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
			}),
		},
		responses: {
			"200": {
				description: "Returns if the video was deleted successfully",
				content: {
					"application/json": {
						schema: z.object({
							series: z.object({
								success: Bool(),
							}),
						}),
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
		const { videoId } = request.params;
		const auth = c.get('auth');
		const userId = auth?.userId;
		const { channelId } = request.headers;

		// Get the video before deletion
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		let video = await repository.getObject(videoId);

		if (!video) {
			return c.json({
				success: false,
				error: "Video not found",
			}, 404);
		}

		// Send queue message for video deletion
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.VideoDelete, {
			videoId: videoId,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		// Delete the video
		await repository.deleteObject(videoId);

		return {
			success: true,
		};
	}
}
