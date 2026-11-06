import { Num, Str } from "chanfana";
import { z } from "zod";
import { Video, Channel, Profile, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from '../../base';
import { logger } from "../../lib/logger";
import { isVideoRemoved } from "../../lib/visibility";
import {
	DEFAULT_COMMENT_PAGE_SIZE,
	MAX_COMMENT_PAGE_SIZE,
	paginateComments,
	resolveCommentAuthor,
	toCommentListItem,
	StoredComment,
} from "../../lib/comments";

const CommentAuthorSchema = z.object({
	userId: z.string(),
	channelId: z.string(),
	displayName: z.string(),
	avatarUrl: z.string().optional(),
});

const CommentListItemSchema = z.object({
	id: z.string(),
	userId: z.string(),
	channelId: z.string(),
	videoId: z.string(),
	text: z.string(),
	dateCreated: z.string(),
	dateModified: z.string(),
	likesCount: z.number(),
	dislikesCount: z.number(),
	repliesCount: z.number(),
	isEdited: z.boolean(),
	isDeleted: z.boolean(),
	isPinned: z.boolean(),
	isLiked: z.boolean(),
	isDisliked: z.boolean(),
	author: CommentAuthorSchema,
});

export class CommentList extends OptionalAuthRoute {
	schema = {
		tags: ["Comments"],
		summary: "List comments for a video",
		description: "Returns a page of comments (pinned first, then newest first) with author display name and avatar. When the request is authenticated with a channelId header, isLiked/isDisliked reflect that channel's reactions.",
		request: {
			params: z.object({
				id: Str({ description: "Video id" }),
			}),
			query: z.object({
				limit: Num({ description: `Page size (max ${MAX_COMMENT_PAGE_SIZE})`, default: DEFAULT_COMMENT_PAGE_SIZE }).optional(),
				cursor: Str({ description: "Cursor returned by the previous page", required: false }),
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
		const userId = this.getUserId(c);
		// channelIdMiddleware has already verified the header belongs to the user
		const viewerChannelId = userId ? c.req.header('channelId') : undefined;

		type VideoType = z.infer<typeof Video>;
		const repository = new R2Repository<VideoType>(c.env.videos);
		const video = await repository.getObject(id);

		if (!video || isVideoRemoved(video) || (video.isPublic === false && (!userId || video.userId !== userId))) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}

		const page = paginateComments(video.comments as unknown as StoredComment[], limit, cursor);

		// Resolve authors once per distinct channel / user on this page
		type ChannelType = z.infer<typeof Channel>;
		type ProfileType = z.infer<typeof Profile>;
		const channelRepo = new R2Repository<ChannelType>(c.env.channels);
		const profileRepo = new R2Repository<ProfileType>(c.env.profiles);

		const channelIds = [...new Set(page.items.map((cm) => cm.channelId).filter(Boolean))];
		const channels = new Map<string, ChannelType | null>();
		await Promise.all(channelIds.map(async (cid) => {
			try {
				channels.set(cid, await channelRepo.getObject(cid));
			} catch (error) {
				logger.warn('[CommentList] Failed to load comment channel', { videoId: id, channelId: cid, error: error instanceof Error ? error.message : String(error) });
				channels.set(cid, null);
			}
		}));

		const userIdsNeedingProfile = [...new Set(page.items
			.filter((cm) => !channels.get(cm.channelId)?.name)
			.map((cm) => cm.userId)
			.filter(Boolean))];
		const profiles = new Map<string, ProfileType | null>();
		await Promise.all(userIdsNeedingProfile.map(async (uid) => {
			try {
				profiles.set(uid, await profileRepo.getObject(uid));
			} catch (error) {
				logger.warn('[CommentList] Failed to load comment profile', { videoId: id, userId: uid, error: error instanceof Error ? error.message : String(error) });
				profiles.set(uid, null);
			}
		}));

		const comments = page.items.map((cm) => toCommentListItem(
			cm,
			resolveCommentAuthor(cm, channels.get(cm.channelId), profiles.get(cm.userId)),
			viewerChannelId,
		));

		logger.debug('[CommentList] Listed comments', { videoId: id, count: comments.length, total: page.total });

		return {
			success: true,
			result: {
				comments,
				nextCursor: page.nextCursor,
				total: page.total,
			},
		};
	}
}
