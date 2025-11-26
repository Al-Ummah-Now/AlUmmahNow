import { Num, Str } from "chanfana";
import { string, z } from "zod";
import { Video as BusinessVideo, Channel as BusinessChannel, PaginationResponse, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from "../../base";

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
				userId: Str({
					description: "User ID (automatically set from JWT token if authenticated)"
				}).optional().nullable(),
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

			// Get videos from R2 bucket
			const bucket = c.env.videos;
			type VideoType = z.infer<typeof BusinessVideo>;
			const repository = new R2Repository<VideoType>(bucket);

			// Use R2's native cursor pagination to get all videos
			const videos = await repository.listObjects(limit * 10, cursor); // Get more to filter

			// Filter videos for live streams and based on privacy settings
			let channelLiveStreams = (videos.items || []).filter(video => {
				// Must belong to this channel
				if (video.channelId !== channelId) {
					return false;
				}

				// Must be a live stream
				if (!video.isLive) {
					return false;
				}

				// If active filter is set, only return active streams
				// Note: We don't have liveStatus field, so we just check isLive for now
				// In the future, we could add liveStatus field to distinguish between active/ended streams
				if (active === true) {
					// For now, all isLive=true videos are considered active
					// This filter doesn't change behavior but is kept for future enhancement
				}

				// If video is explicitly private (false), only show if user is channel owner
				if (video.isPublic === false) {
					return userId && channel.userId === userId;
				}

				// If video is public (true) or undefined/null (default to public), show it
				return true;
			});

			// Sort by latest first
			channelLiveStreams.sort((a, b) => {
				return new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
			});

			// Limit to requested amount
			const limitedStreams = channelLiveStreams.slice(0, limit);

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
			const hasMore = channelLiveStreams.length > limit;
			const nextCursor = hasMore ? videos.cursor : "";

			const response: PaginationResponse<ReturnType<typeof transformToView>> = {
				cursor: nextCursor || "",
				limit,
				data: limitedStreams.map(transformToView),
			};

			const duration = Date.now() - startTime;
			logger.info('Successfully fetched channel live streams', {
				channelId,
				streamsCount: limitedStreams.length,
				totalFiltered: channelLiveStreams.length,
				hasMore,
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
