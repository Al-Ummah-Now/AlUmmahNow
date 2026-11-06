import { Str } from "chanfana";
import { date, z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { broadcastInBackground, notifyUserInBackground } from "../../lib/websocket-notify";
import { Comment } from "../../lib/model/input";
import { AuthenticatedRoute, AppContext } from '../../base';


export class CommentCreate extends AuthenticatedRoute {
	schema = {
		tags: ["Comments"],
		summary: "Create a new comment for a video",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
			}),
			body: {
				content: {
					"application/json": {
						schema: Comment,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the created comment",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								comment: z.object({
									id: z.string(),
									text: z.string(),
									author: z.string(),
									videoId: z.string(),
								}),
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

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();

		const { id } = request.params;
		const userId = this.getUserId(c);
		const { channelId } = request.headers;

		// Implement your own object fetch here
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof Video>;
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

		// Check privacy permissions for commenting on videos
		if (video.isPublic === false && (!userId || video.userId !== userId)) {
			return c.json(
				{
					success: false,
					error: "Object not found", // Don't reveal that private video exists
				},
				404
			);
		}

		const comment = {
			id: crypto.randomUUID(),
			videoId: id,
			userId: userId,
			channelId: channelId,
			...request.body,
			dateCreated: new Date().toISOString(),
			dateModified: new Date().toISOString(),
		};

		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.CommentCreate, {
			commentId: comment.id,
			videoId: id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		const alreadyCommented = video.comments.find((existingComment) => existingComment.text === comment.text && existingComment.channelId === comment.channelId);
		if (alreadyCommented) {
			return c.json(
				{
					success: true,
				},
				201
			);
		}

		video.comments.push(comment);
		// Note: commentsCount is calculated in view layer, not stored

		await repository.putObject(video.id, video);

		// Realtime: new comment for viewers of the video, notification for its owner
		broadcastInBackground(c, `video:${id}`, 'comment_added', {
			videoId: id,
			commentId: comment.id,
			comment: {
				...comment,
				likesCount: 0,
				dislikesCount: 0,
				repliesCount: 0,
				isEdited: false,
				isDeleted: false,
				isPinned: false,
			},
		});
		if (video.userId && video.userId !== userId) {
			notifyUserInBackground(c, video.userId, {
				notificationType: 'comment',
				notificationKey: 'newComment',
				params: { videoTitle: video.title || '' },
				actionUrl: `/video/${id}`,
			});
		}

		return {
			success: true,
			result: { comment },
		};
	}
}
