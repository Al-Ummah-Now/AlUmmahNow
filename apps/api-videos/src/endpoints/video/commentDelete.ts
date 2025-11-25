import { OpenAPIRoute, Str } from "chanfana";
import { date, z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class CommentDelete extends OpenAPIRoute {
	schema = {
		tags: ["Comments"],
		summary: "Delete a comment for a video",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
				cid: Str({ description: "Comment id" }),
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
		const request = await this.getValidatedData<typeof this.schema>();

		const { id, cid } = request.params;
		const auth = c.get('auth');
		const userId = auth?.userId;
		const { channelId } = request.headers;

		// Get the video and find the comment
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof Video>;
		const repository = new R2Repository<VideoType>(bucket);
		let video = await repository.getObject(id);

		if (!video) {
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

		const comment = video.comments.find(comment => comment.id === cid);
		if (!comment) {
			return c.json({
				success: false,
				error: "Comment not found",
			}, 404);
		}

		// Send queue message for comment deletion
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.CommentDelete, {
			commentId: cid,
			videoId: id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		// Remove the comment
		video.comments = video.comments.filter(comment => comment.id !== cid);

		// Save updated video
		await repository.putObject(video.id, video);

		return { success: true };
	}
}
