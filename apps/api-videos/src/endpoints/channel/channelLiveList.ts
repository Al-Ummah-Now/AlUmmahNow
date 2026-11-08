import { Num, Str } from "chanfana";
import { string, z } from "zod";
import { Video as BusinessVideo, Channel as BusinessChannel, PaginationResponse, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from "../../base";
import { waitUntilOf } from "../../lib/search/ownership";
import { channelVideosFromIndex } from "../../lib/search/channelVideoIndex";

export class ChannelLiveList extends OptionalAuthRoute {
	schema = {
		tags: ["Channels"],
		summary: "List Channel Live Streams",
		description: "🔓 **Authentication Optional**: Get all live streams from a specific channel. Returns additional private streams when authenticated as the channel owner.",
		request: {
			params: z.object({
				id: Str({
					description: "Channel ID",
					example: "e6367c19-a759-423e-be12-b52b098bce38"
				}),
			}),
			query: z.object({
				limit: Num({
					description: "Limit the number of live streams to return",
					default: 12,
				}),
				cursor: string({
					description: "The last cursor returned from the previous request for pagination",
				}).optional(),
				active: z.boolean().optional().describe("If true, only return currently active live streams"),
			}),
			headers: z.object({
				channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a list of live streams for the channel",
				content: {
					"application/json": {
						schema: PaginationResponse.extend({ data: z.array(VideoView) }),
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
				description: "Channel not found",
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
		const startTime = Date.now();

		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();
		const { id: channelId } = request.params;
		const { limit, cursor, active } = request.query;
		const userId = this.getUserId(c);

		logger.info('Fetching channel live streams', {
			channelId,
			limit,
			cursor,
			active,
			userId,
			authenticated: !!userId
		});

		try {
			// Verify channel exists
			const channelBucket = c.env.channels;
			type ChannelType = z.infer<typeof BusinessChannel>;
			const channelRepo = new R2Repository<ChannelType>(channelBucket);
			const channel = await channelRepo.getObject(channelId);

			if (!channel) {
				logger.warn('Channel not found', { channelId });
				return c.json({
					success: false,
					error: `Channel ${channelId} not found`
				}, 404);
			}

			// Same channel visibility rules as the Videos and Shorts tabs
			if (channel.isDeleted || channel.isHidden || (channel.isPrivate && channel.userId !== userId)) {
				logger.warn('Channel not listable', { channelId, isDeleted: !!channel.isDeleted, isHidden: !!channel.isHidden });
				return c.json({
					success: false,
					error: 'Channel not found'
				}, 404);
			}

			const bucket = c.env.videos;
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(bucket);
			const isOwner = Boolean(userId && channel.userId === userId);

			// `active` is accepted for compatibility: there is no live status field,
			// so every isLive video counts as active.
			const isListed = (video: VideoType | null): video is VideoType => {
				if (!video) return false;
				if (video.channelId !== channelId) return false;
				if (video.isDeleted || video.isHidden) return false;
				if (!video.isLive) return false;
				if (video.isPublic === false) return isOwner;
				return true;
			};

			let limitedStreams: VideoType[];
			let nextCursor: string;
			let source: "index" | "scan" = "scan";

			// Ownership index (D1) first; a bucket slice misses most streams (#296).
			const page = await channelVideosFromIndex<VideoType>(c.env as never, {
				channelId,
				cursor,
				limit,
				query: { sort: "latest", privateFor: isOwner, liveOnly: true },
				load: id => repository.getObject(id),
				isListed,
				waitUntil: waitUntilOf(c as never),
			});

			if (page) {
				source = "index";
				limitedStreams = page.videos;
				nextCursor = page.cursor;
			} else {
				const videos = await repository.listObjects(limit * 10, cursor);
				const channelLiveStreams = (videos.items || []).filter(isListed).sort((a, b) =>
					new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime());
				limitedStreams = channelLiveStreams.slice(0, limit);
				nextCursor = channelLiveStreams.length > limit ? (videos.cursor || "") : "";
			}

			// Transform business videos to view models
			const transformToView = (video: VideoType) => ({
				...video,
				channelName: channel.name || "",
				channelAvatarUrl: channel.avatarUrl || undefined,
				likesCount: video.likes?.length || 0,
				dislikesCount: video.dislikes?.length || 0,
				commentsCount: video.comments?.length || 0,
			});

			const response: PaginationResponse<ReturnType<typeof transformToView>> = {
				cursor: nextCursor || "",
				limit,
				data: limitedStreams.map(transformToView),
			};

			const duration = Date.now() - startTime;
			logger.info('Successfully fetched channel live streams', {
				channelId,
				streamsCount: limitedStreams.length,
				hasMore: Boolean(nextCursor),
				source,
				duration
			});

			return response;
		} catch (error) {
			logger.error('Error fetching channel live streams', {
				channelId,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
			return c.json({
				success: false,
				error: "Failed to fetch channel live streams"
			}, 500);
		}
	}
}
