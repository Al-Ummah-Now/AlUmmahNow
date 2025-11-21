import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class DislikeDelete extends OpenAPIRoute {
	schema = {
		tags: ["Dislikes"],
		summary: "Remove dislike from a video",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
				userId: Str({ description: "User ID" }),
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
		const { channelId, userId } = request.headers;

		// Implement your own object fetch here
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof Video>;
		const repository = new R2Repository<VideoType>(bucket);
		let video = await repository.getObject(id);

		const exists = video !== null;

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

        const dislike = video.dislikes.find((dislike) => dislike.channelId === channelId && dislike.entityId === id);		

        const queue = new Queue(c.env.queue);
		await queue.send(MessageType.VideoUndislike, {
			dislikeId: dislike.id,
			videoId: id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

        video.dislikes = video.dislikes.filter((d) => d.id !== dislike.id);
        // Note: dislikesCount is calculated in view layer, not stored
        
		await repository.putObject(video.id, video);

		return true;
	}
}

