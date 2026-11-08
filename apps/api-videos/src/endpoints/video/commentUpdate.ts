import { Str } from "chanfana";
import { date, z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from '../../base';
import { MAX_COMMENT_LENGTH, StoredComment, findStoredComment, normalizeCommentText } from "../../lib/comments";
import { broadcastInBackground } from "../../lib/websocket-notify";


export class CommentUpdate extends AuthenticatedRoute {
	schema = {
		tags: ["Comments"],
		summary: "Update a comment for a video",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
				cid: Str({ description: "Comment id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
			}),
			body: {
				content: {
					"application/json": {
						// Accepts `text` (preferred) or `content` (shared-types CommentUpdateRequest)
						schema: z.object({
							text: z.string().optional(),
							content: z.string().optional(),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the updated comment",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								comment: z.object({
									id: z.string(),
									text: z.string(),
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

		// Top-level comment or reply
		const found = findStoredComment(video.comments as unknown as StoredComment[], cid);
		if (!found || found.comment.isDeleted) {
			return c.json({
				success: false,
				error: "Comment not found",
			}, 404);
		}

		// Only the comment author may edit it
		if (found.comment.userId !== userId) {
			return c.json({
				success: false,
				error: "Forbidden",
			}, 403);
		}

		const text = normalizeCommentText(request.body);
		if (!text) {
			return c.json({ success: false, error: "Comment text is required" }, 400);
		}
		if (text.length > MAX_COMMENT_LENGTH) {
			return c.json({ success: false, error: `Comment text must be at most ${MAX_COMMENT_LENGTH} characters` }, 400);
		}

		// Update the comment in place (it lives either in video.comments or in a parent's replies)
		const updatedComment = found.comment;
		const changed = updatedComment.text !== text;
		updatedComment.text = text;
		if (changed) {
			updatedComment.dateModified = new Date().toISOString();
			updatedComment.isEdited = true;
		}

		// Send queue message for comment edit
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.CommentEdit, {
			commentId: cid,
			videoId: id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		// Save updated video
		await repository.putObject(video.id, video);

		if (updatedComment.status !== 'held') {
			broadcastInBackground(c, `video:${id}`, 'comment_updated', {
				videoId: id,
				commentId: cid,
				parentCommentId: found.parent?.id || null,
				comment: {
					id: cid,
					text: updatedComment.text,
					isEdited: updatedComment.isEdited === true,
					dateModified: updatedComment.dateModified || updatedComment.dateCreated,
				},
			});
		}

		return {
			success: true,
			result: { comment: updatedComment },
		};
	}
}
