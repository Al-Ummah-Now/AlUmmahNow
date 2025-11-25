import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class LikeDelete extends OpenAPIRoute {
	schema = {
		tags: ["Likes"],
		summary: "Unlike a video",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
			}),
		},
		responses: {
			"200": {
				description: "Returns success status",
				content: {
					"application/json": {
						schema: {
							success: true,
						},
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
		const auth = c.get('auth');
		const userId = auth?.userId;
		const { channelId } = request.headers;

        // Implement your own object fetch here
        const bucket = c.env.videos;
		type VideoType = z.infer<typeof Video>;
		const repository = new R2Repository<VideoType>(bucket);
		let video = await repository.getObject(id);		const exists = video !== null;

		if (!exists) {
			return Response.json(
				{
					success: false,
					error: "Object not found",
				},
				{
					status: 404,
				},
			);
		}

		const like = video.likes.find((like) => like.channelId === channelId && like.entityId === id);		

		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.VideoUnlike, {
			likeId: like.id,
			videoId: id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		video.likes = video.likes.filter((l) => l.id !== like.id);
		// Note: likesCount is calculated in view layer, not stored

		await repository.putObject(video.id, video);

		return true;
	}
}

