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
	isCommentVisible,
	paginateReplies,
	StoredComment,
} from "../../lib/comments";
import { toCommentListItems } from "../../lib/commentAuthors";
import { CommentListItemSchema } from "./commentList";

/**
 * GET /api/videos/:id/comments/:cid/replies
 *
 * Replies are one level deep (stored in the top-level comment's `replies`)
 * and listed oldest first so a thread reads as a conversation.
 */
export class CommentRepliesList extends OptionalAuthRoute {
	schema = {
		tags: ["Comments"],
		summary: "List replies to a video comment",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
				cid: Str({ description: "Top-level comment id" }),
			}),
			query: z.object({
				limit: Num({ description: `Page size (max ${MAX_COMMENT_PAGE_SIZE})`, default: DEFAULT_COMMENT_PAGE_SIZE }).optional(),
				cursor: Str({ description: "Cursor returned by the previous page", required: false }),
			}),
		},
		responses: {
			"200": {
				description: "A page of replies (oldest first)",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								replies: z.array(CommentListItemSchema),
								nextCursor: z.string().nullable(),
								total: z.number(),
							}),
						}),
					},
				},
			},
			"404": {
				description: "Video or comment not found",
				content: { "application/json": { schema: ResponseError } },
			},
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id, cid } = request.params;
		const { limit, cursor } = request.query;
		const userId = this.getUserId(c);
		const viewerChannelId = userId ? c.req.header('channelId') : undefined;

		type VideoType = z.infer<typeof Video>;
		const video = await new R2Repository<VideoType>(c.env.videos).getObject(id);
		if (!video || isVideoRemoved(video) || (video.isPublic === false && (!userId || video.userId !== userId))) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}

		const viewer: CommentViewer = { userId, isVideoOwner: !!userId && video.userId === userId };
		const parent = ((video.comments || []) as unknown as StoredComment[]).find((cm) => cm.id === cid);
		if (getCommentSettings(video) === 'off' || !parent || !isCommentVisible(parent, viewer)) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}

		const page = paginateReplies<StoredComment>(parent, limit, cursor, viewer);
		const replies = await toCommentListItems(c.env, page.items, viewerChannelId, viewer, { videoId: id, commentId: cid });

		logger.debug('[CommentRepliesList] Listed replies', { videoId: id, commentId: cid, count: replies.length, total: page.total });

		return {
			success: true,
			result: { replies, nextCursor: page.nextCursor, total: page.total },
		};
	}
}
