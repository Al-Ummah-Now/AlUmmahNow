import { isShort } from "@al-ummah/shared-types";
import { Num, Str } from "chanfana";
import { publicVideoFields } from '../../lib/transformations';
import { isVideoPubliclyVisible } from "../../lib/visibility";
import { FALLBACK_SCAN_OBJECTS } from "../../lib/scanBudget";
import { string, z } from "zod";
import { Video as BusinessVideo, Channel as BusinessChannel, PaginationResponse, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from "../../base";
import { waitUntilOf } from "../../lib/search/ownership";
import { channelVideosFromIndex } from "../../lib/search/channelVideoIndex";

export class ChannelVideosList extends OptionalAuthRoute {
	schema = {
		tags: ["Channels"],
		summary: "List Channel Videos",
		description: "🔓 **Authentication Optional**: Get all videos from a specific channel. Returns additional private videos when authenticated as the channel owner.",
		request: {
			params: z.object({
				id: Str({
					description: "Channel ID",
					example: "e6367c19-a759-423e-be12-b52b098bce38"
				}),
			}),
			query: z.object({
				limit: Num({
					description: "Limit the number of videos to return",
					default: 12,
				}),
				cursor: string({
					description: "The last cursor returned from the previous request for pagination",
				}).optional(),
				sort: z.enum(["latest", "popular", "oldest"]).optional().default("latest").describe("Sort order for videos"),
			}),
			headers: z.object({
				channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a list of videos for the channel",
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

		logger.info('Fetching channel videos', {
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
				logger.warn('Channel not found', { channelId });
				return c.json({
					success: false,
					error: `Channel ${channelId} not found`
				}, 404);
			}

			// Check if channel is deleted (soft delete)
			if (channel.isDeleted) {
				logger.warn('Channel is deleted', { channelId });
				return c.json({
					success: false,
					error: 'Channel not found'
				}, 404);
			}

			// Check if channel is hidden (moderation) - blocks everyone including owner
			if (channel.isHidden) {
				logger.warn('Channel is hidden', { channelId });
				return c.json({
					success: false,
					error: 'Channel not found'
				}, 404);
			}

			// Check if channel is private - only owner can access
			if (channel.isPrivate && channel.userId !== userId) {
				logger.warn('Private channel access denied', { channelId, userId });
				return c.json({
					success: false,
					error: 'Channel not found'
				}, 404);
			}

			// Get videos from R2 bucket
			const bucket = c.env.videos;
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(bucket);
			const isOwner = Boolean(userId && channel.userId === userId);

			const isListed = (video: VideoType | null): video is VideoType => {
				if (!video) return false;
				// Must belong to this channel
				if (video.channelId !== channelId) {
					return false;
				}

				// Filter out soft-deleted videos
				if (video.isDeleted) {
					return false;
				}

				// Filter out moderation-hidden videos
				if (video.isHidden) {
					return false;
				}

				// Not ready (uploading, processing, failed), private or scheduled: only the
				// channel owner sees it, with its status (lib/visibility.ts, one rule for every list)
				if (!isVideoPubliclyVisible(video)) {
					return isOwner;
				}

				// Exclude Shorts (shared rule: ≤ 3 min and vertical/square, or the uploader's choice) and live streams
				if (isShort(video)) {
					return false;
				}
				if (video.isLive) {
					return false;
				}

				// If video is public (true) or undefined/null (default to public), show it
				return true;
			};

			let limitedVideos: VideoType[];
			let nextCursor: string;
			let source: "index" | "scan" = "scan";
			let totalFiltered: number | undefined;

			// Ownership index: filter, sort and page in D1, then load only this
			// page's objects (the filter is re-applied to the loaded objects).
			const page = await channelVideosFromIndex<VideoType>(c.env as never, {
				channelId,
				cursor,
				limit,
				query: {
					sort: (sort || "latest") as "latest" | "popular" | "oldest",
					privateFor: isOwner,
					longFormOnly: true,
				},
				load: id => repository.getObject(id),
				isListed,
				waitUntil: waitUntilOf(c as never),
			});

			if (page) {
				source = "index";
				limitedVideos = page.videos;
				nextCursor = page.cursor;
			} else {
				// Index incomplete (or a legacy R2 cursor): previous behaviour, one
				// bounded slice of the bucket (the helper schedules an index heal).
				// Use R2's native cursor pagination to get all videos
				const videos = await repository.listObjects(Math.min(limit * 10, FALLBACK_SCAN_OBJECTS), cursor); // Get more to filter

				// Filter videos for this channel and based on privacy settings
				const channelVideos = (videos.items || []).filter(isListed);

				// Sort videos based on sort parameter
				channelVideos.sort((a, b) => {
					switch (sort) {
						case "latest":
							return new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
						case "popular":
							return (b.views || 0) - (a.views || 0);
						case "oldest":
							return new Date(a.dateCreated || 0).getTime() - new Date(b.dateCreated || 0).getTime();
						default:
							return new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
					}
				});

				// Limit to requested amount
				limitedVideos = channelVideos.slice(0, limit);
				totalFiltered = channelVideos.length;

				// Since we filtered after fetching, we need to manage cursor differently
				const hasMore = channelVideos.length > limit;
				nextCursor = hasMore ? videos.cursor : "";
			}

			// Transform business videos to view models
			const transformToView = (video: VideoType) => ({
				...publicVideoFields(video),
				channelName: channel.name || "",
				channelAvatarUrl: channel.avatarUrl || undefined,
				likesCount: video.likes?.length || 0,
				dislikesCount: video.dislikes?.length || 0,
				isShort: isShort(video),
				commentsCount: video.comments?.length || 0,
			});

			const response: PaginationResponse<ReturnType<typeof transformToView>> = {
				cursor: nextCursor || "",
				limit,
				data: limitedVideos.map(transformToView),
			};

			const duration = Date.now() - startTime;
			logger.info('Successfully fetched channel videos', {
				channelId,
				videosCount: limitedVideos.length,
				totalFiltered,
				hasMore: Boolean(nextCursor),
				source,
				duration
			});

			return response;
		} catch (error) {
			logger.error('Error fetching channel videos', {
				channelId,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
			return c.json({
				success: false,
				error: "Failed to fetch channel videos"
			}, 500);
		}
	}
}