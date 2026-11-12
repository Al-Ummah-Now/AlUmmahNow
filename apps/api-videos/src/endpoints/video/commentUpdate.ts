import { Str } from "chanfana";
import { date, z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from '../../base';
import { MAX_COMMENT_LENGTH, StoredComment, findStoredComment, normalizeCommentText, withoutDislikes } from "../../lib/comments";
import { broadcastInBackground } from "../../lib/websocket-notify";
import { scanInBackground } from '../../lib/moderation-scan';


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

		// Conditional write (SCALABILITY-AUDIT AV-2): the edit is applied to the
		// fresh video, so concurrent comments, likes or edits are not overwritten.
		let updatedComment = found.comment;
		let changed = false;
		const { data: saved, rejected } = await repository.updateObjectOrReject<{ status: 403 | 404; error: string }>(id, (fresh) => {
			const target = findStoredComment(fresh.comments as unknown as StoredComment[], cid);
			if (!target || target.comment.isDeleted) return { reject: { status: 404, error: "Comment not found" } };
			if (target.comment.userId !== userId) return { reject: { status: 403, error: "Forbidden" } };
			changed = target.comment.text !== text;
			updatedComment = target.comment;
			if (!changed) return false;
			target.comment.text = text;
			target.comment.dateModified = new Date().toISOString();
			target.comment.isEdited = true;
			return true;
		});
		if (!saved) {
			return c.json({ success: false, error: "Video not found" }, 404);
		}
		if (rejected) {
			return c.json({ success: false, error: rejected.error }, rejected.status);
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

		if (changed) {
			scanInBackground(c, { surface: 'video_comment', event: 'edit', subjectId: cid, parentId: id, authorId: userId, channelId, text });
		}

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
			// Comment dislikes are hidden (2026-11-12)
			result: { comment: withoutDislikes(updatedComment) },
		};
	}
}
