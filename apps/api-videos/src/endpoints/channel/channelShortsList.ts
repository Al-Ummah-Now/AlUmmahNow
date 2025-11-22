import { Num, OpenAPIRoute, Str } from "chanfana";
import { string, z } from "zod";
import { Video as BusinessVideo, Channel as BusinessChannel, PaginationResponse, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';

export class ChannelShortsList extends OpenAPIRoute {
	schema = {
		tags: ["Channels"],
		summary: "List Channel Shorts",
		description: "🔓 **Authentication Optional**: Get all short-form videos (< 60 seconds) from a specific channel. Returns additional private shorts when authenticated as the channel owner.",
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
				userId: Str({
					description: "User ID (automatically set from JWT token if authenticated)"
				}).optional().nullable(),
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

	async handle(c) {
		const startTime = Date.now();

		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();
		const { id: channelId } = request.params;
		const { limit, cursor, sort } = request.query;
		const { userId } = request.headers;

		logger.info('Fetching channel shorts', {
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

			// Get videos from R2 bucket
			const bucket = c.env.videos;
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(bucket);

			// Use R2's native cursor pagination to get all videos
			const videos = await repository.listObjects(limit * 10, cursor); // Get more to filter

			// Filter videos for this channel's shorts (< 60 seconds) and based on privacy settings
			let channelShorts = (videos.items || []).filter(video => {
				// Must belong to this channel
				if (video.channelId !== channelId) {
					return false;
				}

				// Must be a short (duration < 60 seconds)
				// If duration is not set, exclude it from shorts
				if (!video.duration || video.duration >= 60) {
					return false;
				}

				// Exclude live streams (even if short duration)
				if (video.isLive) {
					return false;
				}

				// If video is explicitly private (false), only show if user is channel owner
				if (video.isPublic === false) {
					return userId && channel.userId === userId;
				}

				// If video is public (true) or undefined/null (default to public), show it
				return true;
			});

			// Sort shorts based on sort parameter
			channelShorts.sort((a, b) => {
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
			const limitedShorts = channelShorts.slice(0, limit);

			// Transform business videos to view models
			const transformToView = (video: VideoType) => ({
				...video,
				channelName: channel.name || "",
				channelAvatarUrl: channel.avatarUrl || undefined,
				likesCount: video.likes?.length || 0,
				dislikesCount: video.dislikes?.length || 0,
				commentsCount: video.comments?.length || 0,
			});

			// Return response with custom cursor for pagination
			// Since we filtered after fetching, we need to manage cursor differently
			const hasMore = channelShorts.length > limit;
			const nextCursor = hasMore ? videos.cursor : "";

			const response: PaginationResponse<ReturnType<typeof transformToView>> = {
				cursor: nextCursor || "",
				limit,
				data: limitedShorts.map(transformToView),
			};

			const duration = Date.now() - startTime;
			logger.info('Successfully fetched channel shorts', {
				channelId,
				shortsCount: limitedShorts.length,
				totalFiltered: channelShorts.length,
				hasMore,
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
