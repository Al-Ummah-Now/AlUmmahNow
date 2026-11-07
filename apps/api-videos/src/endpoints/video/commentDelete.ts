import { Str } from "chanfana";
import { date, z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from '../../base';
import { StoredComment, findStoredComment, removeStoredComment } from "../../lib/comments";
import { broadcastInBackground } from "../../lib/websocket-notify";

export class CommentDelete extends AuthenticatedRoute {
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

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();

		const { id, cid } = request.params;
		const userId = this.getUserId(c);
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

		const found = findStoredComment(video.comments as unknown as StoredComment[], cid);
		const comment = found?.comment;
		if (!found || !comment) {
			return c.json({
				success: false,
				error: "Comment not found",
			}, 404);
		}

		// The comment author or the video owner may delete a comment
		if (comment.userId !== userId && video.userId !== userId) {
			return c.json({
				success: false,
				error: "Forbidden",
			}, 403);
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

		// Remove the comment (a top-level comment takes its replies with it)
		video.comments = removeStoredComment(video.comments as unknown as StoredComment[], cid).comments as unknown as typeof video.comments;

		// Save updated video
		await repository.putObject(video.id, video);

		broadcastInBackground(c, `video:${id}`, 'comment_deleted', {
			videoId: id,
			commentId: cid,
			parentCommentId: found.parent?.id || null,
		});

		return { success: true };
	}
}
