import { canOnVideo } from "../../lib/channelAccess";
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
		if (video.isPublic === false && !(await canOnVideo(c.env as never, video, userId, 'video.view_private')) && !(await canOnVideo(c.env as never, video, userId, 'comment.moderate'))) {
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

		// The comment author, or the video's owner or a channel admin or moderator (comment.moderate)
		const moderates = await canOnVideo(c.env as never, video, userId, 'comment.moderate');
		if (comment.userId !== userId && !moderates) {
			return c.json({
				success: false,
				error: "Forbidden",
			}, 403);
		}

		// Remove the comment (a top-level comment takes its replies with it) on
		// the fresh video (SCALABILITY-AUDIT AV-2), so concurrent changes survive.
		const { data: saved, rejected } = await repository.updateObjectOrReject<{ status: 403 | 404; error: string }>(id, (fresh) => {
			const target = findStoredComment(fresh.comments as unknown as StoredComment[], cid);
			if (!target) return { reject: { status: 404, error: "Comment not found" } };
			if (target.comment.userId !== userId && !(moderates && fresh.userId === video.userId)) return { reject: { status: 403, error: "Forbidden" } };
			fresh.comments = removeStoredComment(fresh.comments as unknown as StoredComment[], cid).comments as unknown as typeof fresh.comments;
			return true;
		});
		if (!saved) {
			return c.json({ success: false, error: "Video not found" }, 404);
		}
		if (rejected) {
			return c.json({ success: false, error: rejected.error }, rejected.status);
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

		broadcastInBackground(c, `video:${id}`, 'comment_deleted', {
			videoId: id,
			commentId: cid,
			parentCommentId: found.parent?.id || null,
		});

		return { success: true };
	}
}
