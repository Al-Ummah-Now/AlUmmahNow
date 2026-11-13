import { isShort } from "@al-ummah/shared-types";
import { Num, Str } from "chanfana";
import { publicVideoFields, uploaderProcessingIssue } from '../../lib/transformations';
import { isVideoPubliclyVisible } from "../../lib/visibility";
import { string, z } from "zod";
import { Video as BusinessVideo, Channel as BusinessChannel, PaginationResponse, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from "../../base";
import { waitUntilOf } from "../../lib/search/ownership";
import { channelVideosFromIndex } from "../../lib/search/channelVideoIndex";
import { scanFill } from "../../lib/listFill";
import { PUBLIC_DISLIKES_COUNT } from "../../lib/reactions";
import { channelNameFields } from '../../lib/channelName';

export class ChannelShortsList extends OptionalAuthRoute {
	schema = {
		tags: ["Channels"],
		summary: "List Channel Shorts",
		description: "🔓 **Authentication Optional**: Get the Shorts of a specific channel (≤ 3 minutes and vertical or square, or marked as a Short by the uploader). Returns additional private shorts when authenticated as the channel owner.",
		request: {
			params: z.object({
				id: Str({
					description: "Channel ID",
					example: "e6367c19-a759-423e-be12-b52b098bce38"
				}),
			}),
			query: z.object({
				limit: Num({
					description: "Limit the number of shorts to return",
					default: 12,
				}),
				cursor: string({
					description: "The last cursor returned from the previous request for pagination",
				}).optional(),
				sort: z.enum(["latest", "popular", "oldest"]).optional().default("latest").describe("Sort order for shorts"),
			}),
			headers: z.object({
				channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a list of shorts for the channel",
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
		const { limit, cursor, sort } = request.query;
		const userId = this.getUserId(c);

		logger.debug('Fetching channel shorts', {
			channelId,
			limit,
			cursor,
			sort,
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
				logger.debug('Channel not found', { channelId });
				return c.json({
					success: false,
					error: `Channel ${channelId} not found`
				}, 404);
			}

			// Same visibility rules as the Videos tab (deleted, hidden and private channels are not listed)
			if (channel.isDeleted || channel.isHidden || (channel.isPrivate && channel.userId !== userId)) {
				logger.debug('Channel not listable', { channelId, isDeleted: !!channel.isDeleted, isHidden: !!channel.isHidden });
				return c.json({
					success: false,
					error: 'Channel not found'
				}, 404);
			}

			const bucket = c.env.videos;
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(bucket);
			const isOwner = Boolean(userId && channel.userId === userId);

			const isListed = (video: VideoType | null): video is VideoType => {
				if (!video) return false;
				if (video.channelId !== channelId) return false;
				if (video.isDeleted || video.isHidden) return false;
				// Shared rule: ≤ 3 min and vertical/square, or the uploader's choice; never live
				if (!isShort(video)) return false;
				if (video.isLive) return false;
				// Not ready, private or scheduled: only the channel owner (lib/visibility.ts)
				return isVideoPubliclyVisible(video) || isOwner;
			};

			const byDate = (a: VideoType, b: VideoType) =>
				new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
			const compare = (a: VideoType, b: VideoType) => {
				switch (sort) {
					case "popular":
						return (b.views || 0) - (a.views || 0);
					case "oldest":
						return -byDate(a, b);
					default:
						return byDate(a, b);
				}
			};

			let limitedShorts: VideoType[];
			let nextCursor: string;
			let source: "index" | "scan" = "scan";

			// Ownership index (D1): filter, sort and page by channel, then load only
			// this page's objects. A bucket slice almost never contains a new short (#296).
			const page = await channelVideosFromIndex<VideoType>(c.env as never, {
				channelId,
				cursor,
				limit,
				query: {
					sort: (sort || "latest") as "latest" | "popular" | "oldest",
					privateFor: isOwner,
					shortsOnly: true,
				},
				load: id => repository.getObject(id),
				isListed,
				waitUntil: waitUntilOf(c as never),
			});

			if (page) {
				source = "index";
				limitedShorts = page.videos;
				nextCursor = page.cursor;
			} else {
				// Index incomplete (or a scan cursor): a bounded bucket scan that fills
				// the page (lib/listFill.ts); the helper above schedules an index heal.
				const scan = await scanFill<VideoType>({
					bucket: c.env.videos,
					cursor,
					limit,
					load: key => repository.getObject(key),
					isListed,
					label: 'ChannelShortsList',
				});
				limitedShorts = scan.items.sort(compare);
				nextCursor = scan.cursor;
			}

			// Transform business videos to view models
			const transformToView = (video: VideoType) => ({
				...publicVideoFields(video),
				...uploaderProcessingIssue(video, channel, userId),
				...channelNameFields(channel),
				channelAvatarUrl: channel.avatarUrl || undefined,
				likesCount: video.likes?.length || 0,
				dislikesCount: PUBLIC_DISLIKES_COUNT,
				isShort: isShort(video),
				commentsCount: video.comments?.length || 0,
			});

			const response: PaginationResponse<ReturnType<typeof transformToView>> = {
				cursor: nextCursor || "",
				limit,
				data: limitedShorts.map(transformToView),
			};

			const duration = Date.now() - startTime;
			logger.debug('Successfully fetched channel shorts', {
				channelId,
				shortsCount: limitedShorts.length,
				hasMore: Boolean(nextCursor),
				source,
				duration
			});

			return response;
		} catch (error) {
			logger.error('Error fetching channel shorts', {
				channelId,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
			return c.json({
				success: false,
				error: "Failed to fetch channel shorts"
			}, 500);
		}
	}
}
