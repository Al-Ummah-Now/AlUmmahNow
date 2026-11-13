import { Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { broadcastInBackground, notifyUserInBackground } from "../../lib/websocket-notify";
import { AuthenticatedRoute, AppContext } from '../../base';
import { logger } from "../../lib/logger";
import { isVideoRemoved, isRestrictedVideo } from "../../lib/visibility";
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
import { reactorId } from "../../lib/reactions";


export class CommentCreate extends AuthenticatedRoute {
	schema = {
		tags: ["Comments"],
		summary: "Create a comment or a reply on a video",
		description: "Posts a top-level comment, or a reply when `parentCommentId` is set, as the channel in the channelId header or, without one, as the member themselves (`channelId: null`, author from the profile). Replies are one level deep: replying to a reply attaches to its top-level comment. Returns 403 `comments_disabled` when the video's comment settings are off; when they are `held` the comment is stored for the owner's review (`isHeld: true`) and not broadcast until approved.",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			headers: z.object({
				// A missing header reaches the schema as null (#1139): no channel means as yourself
				channelId: Str({ description: "The caller's active channel to comment as; omit to comment as yourself (your display name and avatar)" }).optional().nullable(),
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
		// No channel active: the comment is the member's own (author = profile name and avatar, #1151)
		const channelId = request.headers.channelId || null;
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
		const now = new Date().toISOString();
		const commentId = crypto.randomUUID();
		let comment = undefined as StoredComment | undefined;
		let parent = undefined as StoredComment | undefined;
		let held = false;

		// Conditional write (SCALABILITY-AUDIT AV-2): the checks and the append
		// run on the fresh video each attempt, so a concurrent comment, like or
		// edit is re-read instead of overwritten.
		const { data: video, rejected } = await repository.updateObjectOrReject<{ status: 403 | 404; error: string; message?: string }>(id, (fresh) => {
			comment = undefined;
			parent = undefined;
			if (isVideoRemoved(fresh)) return { reject: { status: 404, error: "Object not found" } };
			// Check privacy permissions for commenting on videos
			if (isRestrictedVideo(fresh) && fresh.userId !== userId) {
				// Don't reveal that private video exists
				return { reject: { status: 404, error: "Object not found" } };
			}
			const settings = getCommentSettings(fresh);
			if (settings === 'off') {
				return { reject: { status: 403, error: "comments_disabled", message: "Comments are turned off for this video" } };
			}

			if (!fresh.comments) {
				fresh.comments = [];
			}
			const stored = fresh.comments as unknown as StoredComment[];
			const isVideoOwner = fresh.userId === userId;

			// Replies attach to the top-level comment (one level of nesting)
			if (requestedParentId) {
				const found = findStoredComment(stored, requestedParentId);
				const target = found ? (found.parent || found.comment) : null;
				if (!target || !isCommentVisible(target, { userId, isVideoOwner })) {
					return { reject: { status: 404, error: "Parent comment not found" } };
				}
				parent = target;
			}

			// The owner's own comments are never held
			held = settings === 'held' && !isVideoOwner;
			comment = {
				id: commentId,
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
			return true;
		});

		if (!video) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}
		if (rejected || !comment) {
			const failure = rejected ?? { status: 404 as const, error: "Object not found" };
			return c.json({ success: false, error: failure.error, ...(failure.message ? { message: failure.message } : {}) }, failure.status);
		}
		const isVideoOwner = video.userId === userId;

		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.CommentCreate, {
			commentId: comment.id,
			videoId: id,
			userId,
			...(channelId ? { channelId } : {}),
			parentCommentId: parent?.id,
			held,
			timestamp: now,
		});

		scanInBackground(c, { surface: 'video_comment', event: 'create', subjectId: comment.id, parentId: id, authorId: userId, channelId: channelId ?? undefined, text });

		const [item] = await toCommentListItems(c.env, [comment], reactorId(channelId, userId), { userId, isVideoOwner }, { videoId: id });

		logger.debug('[CommentCreate] Comment created', { videoId: id, commentId: comment.id, channelId, parentCommentId: parent?.id, held });

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
