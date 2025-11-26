import { Num, Str } from "chanfana";
import { string, z } from "zod";
import { Playlist as BusinessPlaylist, Channel as BusinessChannel, PaginationResponse, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from "../../base";

export class ChannelPlaylistsList extends OptionalAuthRoute {
	schema = {
		tags: ["Channels"],
		summary: "List Channel Playlists",
		description: "🔓 **Authentication Optional**: Get all playlists from a specific channel. Returns additional private playlists when authenticated as the channel owner.",
		request: {
			params: z.object({
				id: Str({
					description: "Channel ID",
					example: "e6367c19-a759-423e-be12-b52b098bce38"
				}),
			}),
			query: z.object({
				limit: Num({
					description: "Limit the number of playlists to return",
					default: 12,
				}),
				cursor: string({
					description: "The last cursor returned from the previous request for pagination",
				}).optional(),
			}),
			headers: z.object({
				userId: Str({
					description: "User ID (automatically set from JWT token if authenticated)"
				}).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a list of playlists for the channel",
				content: {
					"application/json": {
						schema: PaginationResponse.extend({ data: z.array(BusinessPlaylist) }),
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
		const { limit, cursor } = request.query;
		const userId = this.getUserId(c);

		logger.info('Fetching channel playlists', {
			channelId,
			limit,
			cursor,
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

			// Get playlists from R2 bucket
			const bucket = c.env.playlists;
			type PlaylistType = z.infer<typeof BusinessPlaylist>;
			const repository = new R2Repository<PlaylistType>(bucket);

			// Use R2's native cursor pagination to get all playlists
			const playlists = await repository.listObjects(limit * 10, cursor); // Get more to filter

			// Filter playlists for this channel and based on privacy settings
			let channelPlaylists = (playlists.items || []).filter(playlist => {
				// Must belong to this channel
				if (playlist.channelId !== channelId) {
					return false;
				}

				// Filter out soft-deleted playlists
				if (playlist.isDeleted) {
					return false;
				}

				// Filter out moderation-hidden playlists
				if (playlist.isHidden) {
					return false;
				}

				// If playlist is explicitly private (false), only show if user is channel owner
				if (playlist.isPublic === false) {
					return userId && channel.userId === userId;
				}

				// If playlist is public (true) or undefined/null (default to public), show it
				return true;
			});

			// Sort by latest first
			channelPlaylists.sort((a, b) => {
				return new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
			});

			// Limit to requested amount
			const limitedPlaylists = channelPlaylists.slice(0, limit);

			// Return response with custom cursor for pagination
			const hasMore = channelPlaylists.length > limit;
			const nextCursor = hasMore ? playlists.cursor : "";

			const response: PaginationResponse<PlaylistType> = {
				cursor: nextCursor || "",
				limit,
				data: limitedPlaylists,
			};

			const duration = Date.now() - startTime;
			logger.info('Successfully fetched channel playlists', {
				channelId,
				playlistsCount: limitedPlaylists.length,
				totalFiltered: channelPlaylists.length,
				hasMore,
				duration
			});

			return response;
		} catch (error) {
			logger.error('Error fetching channel playlists', {
				channelId,
				error: error instanceof Error ? error.message : 'Unknown error'
			});
			return c.json({
				success: false,
				error: "Failed to fetch channel playlists"
			}, 500);
		}
	}
}
