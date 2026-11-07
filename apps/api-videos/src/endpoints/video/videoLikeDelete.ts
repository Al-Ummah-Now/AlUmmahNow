import { Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { broadcastInBackground } from "../../lib/websocket-notify";
import { removeLike } from "../../lib/library";
import { AuthenticatedRoute, AppContext } from '../../base';

export class LikeDelete extends AuthenticatedRoute {
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

	async handle(c: AppContext) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Retrieve the validated slug
		const { id } = request.params;
		const userId = this.getUserId(c);
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

		const like = (video.likes || []).find((like) => like.channelId === channelId && like.entityId === id);

		// Unlike is idempotent: nothing stored for this channel means nothing to remove
		if (!like) {
			await removeLike(c.env.NOTIFICATIONS_DB, userId, id);
			return c.json({ success: true }, 200);
		}

		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.VideoUnlike, {
			likeId: like.id,
			videoId: id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		video.likes = video.likes.filter((l) => l.id !== like.id);
		// Keep the liked-videos index while another of the user's channels still likes it
		if (!video.likes.some((l) => l.userId === userId)) {
			await removeLike(c.env.NOTIFICATIONS_DB, userId, id);
		}
		// Note: likesCount is calculated in view layer, not stored

		await repository.putObject(video.id, video);

		broadcastInBackground(c, `video:${id}`, 'video_unliked', {
			videoId: id,
			userId,
			likesCount: video.likes.length,
			dislikesCount: video.dislikes?.length || 0,
		});

		return true;
	}
}

