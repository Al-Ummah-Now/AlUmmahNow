import { Str } from "chanfana";
import { z } from "zod";
import { Video, Channel, Profile, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { broadcastInBackground, notifyUserInBackground } from "../../lib/websocket-notify";
import { AuthenticatedRoute, AppContext } from '../../base';
import { logger } from "../../lib/logger";
import { isVideoRemoved } from "../../lib/visibility";
import { MAX_COMMENT_LENGTH, normalizeCommentText, resolveCommentAuthor, toCommentListItem } from "../../lib/comments";


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
						// Accepts `text` (preferred) or `content` (shared-types CommentCreateRequest)
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
				description: "Returns the created comment with its author",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								comment: z.object({
									id: z.string(),
									text: z.string(),
									videoId: z.string(),
									author: z.object({
										displayName: z.string(),
										avatarUrl: z.string().optional(),
									}),
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
			"404": {
				description: "Video not found",
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

		if (!video.comments) {
			video.comments = [];
		}

		const now = new Date().toISOString();
		const comment = {
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
		};

		video.comments.push(comment);
		// Note: commentsCount is calculated in view layer, not stored
		await repository.putObject(video.id, video);

		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.CommentCreate, {
			commentId: comment.id,
			videoId: id,
			userId,
			channelId,
			timestamp: now,
		});

		// Resolve the author so the client can render the comment immediately
		type ChannelType = z.infer<typeof Channel>;
		type ProfileType = z.infer<typeof Profile>;
		let channel: ChannelType | null = null;
		let profile: ProfileType | null = null;
		try {
			channel = await new R2Repository<ChannelType>(c.env.channels).getObject(channelId);
			if (!channel?.name) {
				profile = await new R2Repository<ProfileType>(c.env.profiles).getObject(userId);
			}
		} catch (error) {
			logger.warn('[CommentCreate] Failed to resolve comment author', { videoId: id, channelId, error: error instanceof Error ? error.message : String(error) });
		}

		logger.info('[CommentCreate] Comment created', { videoId: id, commentId: comment.id, channelId });

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
			result: {
				comment: toCommentListItem(comment, resolveCommentAuthor(comment, channel, profile), channelId),
			},
		};
	}
}
