import { canOnVideo } from "../../lib/channelAccess";
import { Num, Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from '../../base';
import { logger } from "../../lib/logger";
import { isVideoRemoved } from "../../lib/visibility";
import {
	CommentViewer,
	DEFAULT_COMMENT_PAGE_SIZE,
	MAX_COMMENT_PAGE_SIZE,
	getCommentSettings,
	paginateComments,
	parseCommentSort,
	StoredComment,
} from "../../lib/comments";
import { toCommentListItems } from "../../lib/commentAuthors";

const CommentAuthorSchema = z.object({
	userId: z.string(),
	channelId: z.string(),
	displayName: z.string(),
	avatarUrl: z.string().optional(),
});

export const CommentListItemSchema = z.object({
	id: z.string(),
	userId: z.string(),
	channelId: z.string(),
	videoId: z.string(),
	text: z.string(),
	dateCreated: z.string(),
	dateModified: z.string(),
	likesCount: z.number(),
	dislikesCount: z.number().describe("Always 0: comment dislikes are hidden since 2026-11-12"),
	repliesCount: z.number(),
	isEdited: z.boolean(),
	isDeleted: z.boolean(),
	isPinned: z.boolean(),
	isLiked: z.boolean(),
	isDisliked: z.boolean().describe("Always false: comment dislikes are hidden since 2026-11-12"),
	isHeld: z.boolean().describe("Awaiting the video owner's review (visible to its author and the owner only)"),
	parentCommentId: z.string().nullable(),
	author: CommentAuthorSchema,
});

export class CommentList extends OptionalAuthRoute {
	schema = {
		tags: ["Comments"],
		summary: "List comments for a video",
		description: "Returns a page of top-level comments (pinned first, then by `sort`: newest first, or top = most likes) with author display name and avatar. Replies are listed by GET /api/videos/:id/comments/:cid/replies. When the request is authenticated with a channelId header, isLiked reflects that channel's like (isDisliked is always false: comment dislikes are hidden since 2026-11-12). Held-for-review comments are included for their author and the video owner only. When comments are off the list is empty and commentSettings is `off`.",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			query: z.object({
				limit: Num({ description: `Page size (max ${MAX_COMMENT_PAGE_SIZE})`, default: DEFAULT_COMMENT_PAGE_SIZE }).optional(),
				cursor: Str({ description: "Cursor returned by the previous page", required: false }),
				sort: z.enum(['newest', 'top']).optional().describe("Sort order (default newest)"),
			}),
		},
		responses: {
			"200": {
				description: "A page of comments",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								comments: z.array(CommentListItemSchema),
								nextCursor: z.string().nullable(),
								total: z.number(),
								sort: z.enum(['newest', 'top']),
								commentSettings: z.enum(['on', 'held', 'off']),
							}),
						}),
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
		const { limit, cursor } = request.query;
		const sort = parseCommentSort(request.query.sort);
		const userId = this.getUserId(c);
		// channelIdMiddleware has already verified the header belongs to the user
		const viewerChannelId = userId ? c.req.header('channelId') : undefined;

		type VideoType = z.infer<typeof Video>;
		const repository = new R2Repository<VideoType>(c.env.videos);
		const video = await repository.getObject(id);

		if (!video || isVideoRemoved(video) || (video.isPublic === false && (!userId || video.userId !== userId))) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}

		const commentSettings = getCommentSettings(video);
		// Held comments show to the video's owner and to channel admins and moderators
		const viewer: CommentViewer = { userId, isVideoOwner: await canOnVideo(c.env as never, video, userId, 'comment.moderate') };
		const page = commentSettings === 'off'
			? { items: [] as StoredComment[], nextCursor: null, total: 0 }
			: paginateComments(video.comments as unknown as StoredComment[], limit, cursor, sort, viewer);

		const comments = await toCommentListItems(c.env, page.items, viewerChannelId, viewer, { videoId: id });

		logger.debug('[CommentList] Listed comments', { videoId: id, count: comments.length, total: page.total, sort, commentSettings });

		return {
			success: true,
			result: {
				comments,
				nextCursor: page.nextCursor,
				total: page.total,
				sort,
				commentSettings,
			},
		};
	}
}
