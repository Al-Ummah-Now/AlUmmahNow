import { Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { broadcastInBackground, notifyUserInBackground } from "../../lib/websocket-notify";
import { AuthenticatedRoute, AppContext } from '../../base';
import { logger } from "../../lib/logger";
import { isVideoRemoved } from "../../lib/visibility";
import {
	MAX_COMMENT_LENGTH,
	StoredComment,
	findStoredComment,
	getCommentSettings,
	isCommentVisible,
	normalizeCommentText,
} from "../../lib/comments";
import { toCommentListItems } from "../../lib/commentAuthors";
import { CommentListItemSchema } from "./commentList";
import { scanInBackground } from '../../lib/moderation-scan';


export class CommentCreate extends AuthenticatedRoute {
	schema = {
		tags: ["Comments"],
		summary: "Create a comment or a reply on a video",
		description: "Posts a top-level comment, or a reply when `parentCommentId` is set. Replies are one level deep: replying to a reply attaches to its top-level comment. Returns 403 `comments_disabled` when the video's comment settings are off; when they are `held` the comment is stored for the owner's review (`isHeld: true`) and not broadcast until approved.",
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
						// Accepts `text` (preferred) or `content` (shared-types CommentCreateRequest)
						schema: z.object({
							text: z.string().optional(),
							content: z.string().optional(),
							parentCommentId: z.string().optional().describe("Reply to this comment"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the created comment with its author",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								comment: CommentListItemSchema,
							}),
						}),
					},
				},
			},
			"400": {
				description: "Bad request - invalid input data",
				content: { "application/json": { schema: ResponseError } },
			},
			"403": {
				description: "Comments are turned off for this video",
				content: { "application/json": { schema: ResponseError } },
			},
			"404": {
				description: "Video (or parent comment) not found",
				content: { "application/json": { schema: ResponseError } },
			},
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();

		const { id } = request.params;
		const userId = this.getUserId(c);
		const { channelId } = request.headers;
		const requestedParentId = request.body?.parentCommentId?.trim() || undefined;

		const text = normalizeCommentText(request.body);
		if (!text) {
			return c.json({ success: false, error: "Comment text is required" }, 400);
		}
		if (text.length > MAX_COMMENT_LENGTH) {
			return c.json({ success: false, error: `Comment text must be at most ${MAX_COMMENT_LENGTH} characters` }, 400);
		}

		type VideoType = z.infer<typeof Video>;
		const repository = new R2Repository<VideoType>(c.env.videos);
		const video = await repository.getObject(id);

		if (!video || isVideoRemoved(video)) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}

		// Check privacy permissions for commenting on videos
		if (video.isPublic === false && video.userId !== userId) {
			// Don't reveal that private video exists
			return c.json({ success: false, error: "Object not found" }, 404);
		}

		const settings = getCommentSettings(video);
		if (settings === 'off') {
			return c.json({ success: false, error: "comments_disabled", message: "Comments are turned off for this video" }, 403);
		}

		if (!video.comments) {
			video.comments = [];
		}
		const stored = video.comments as unknown as StoredComment[];
		const isVideoOwner = video.userId === userId;

		// Replies attach to the top-level comment (one level of nesting)
		let parent: StoredComment | null = null;
		if (requestedParentId) {
			const found = findStoredComment(stored, requestedParentId);
			parent = found ? (found.parent || found.comment) : null;
			if (!parent || !isCommentVisible(parent, { userId, isVideoOwner })) {
				return c.json({ success: false, error: "Parent comment not found" }, 404);
			}
		}

		// The owner's own comments are never held
		const held = settings === 'held' && !isVideoOwner;
		const now = new Date().toISOString();
		const comment: StoredComment = {
			id: crypto.randomUUID(),
			videoId: id,
			userId,
			channelId,
			text,
			likes: [],
			dislikes: [],
			replies: [],
			isEdited: false,
			isDeleted: false,
			isPinned: false,
			dateCreated: now,
			dateModified: now,
			...(parent ? { parentCommentId: parent.id } : {}),
			...(held ? { status: 'held' as const } : {}),
		};

		if (parent) {
			parent.replies = [...(parent.replies || []), comment];
		} else {
			stored.push(comment);
		}
		// Note: commentsCount is calculated in view layer, not stored
		await repository.putObject(video.id, video);

		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.CommentCreate, {
			commentId: comment.id,
			videoId: id,
			userId,
			channelId,
			parentCommentId: parent?.id,
			held,
			timestamp: now,
		});

		scanInBackground(c, { surface: 'video_comment', event: 'create', subjectId: comment.id, parentId: id, authorId: userId, channelId, text });

		const [item] = await toCommentListItems(c.env, [comment], channelId, { userId, isVideoOwner }, { videoId: id });

		logger.info('[CommentCreate] Comment created', { videoId: id, commentId: comment.id, channelId, parentCommentId: parent?.id, held });

		if (!held) {
			// Realtime: viewers of the video get the comment with its author (no viewer-specific flags)
			broadcastInBackground(c, `video:${id}`, 'comment_added', {
				videoId: id,
				commentId: comment.id,
				parentCommentId: parent?.id || null,
				comment: { ...item, isLiked: false, isDisliked: false },
			});
		}
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
			result: {
				comment: item,
			},
		};
	}
}
