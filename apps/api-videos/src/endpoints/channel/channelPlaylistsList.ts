import { Num, Str } from "chanfana";
import { scanFill } from "../../lib/listFill";
import { string, z } from "zod";
import { Playlist as BusinessPlaylist, Channel as BusinessChannel, PaginationResponse, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { toPlaylistResponse } from "../../lib/playlists";
import { withPlaylistCovers } from "../../lib/playlistCovers";
import { isSystemPlaylist } from "../../lib/library";
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
				channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
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

		logger.debug('Fetching channel playlists', {
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
				logger.debug('Channel not found', { channelId });
				return c.json({
					success: false,
					error: `Channel ${channelId} not found`
				}, 404);
			}

			// Check if channel is deleted (soft delete)
			if (channel.isDeleted) {
				logger.debug('Channel is deleted', { channelId });
				return c.json({
					success: false,
					error: 'Channel not found'
				}, 404);
			}

			// Check if channel is hidden (moderation) - blocks everyone including owner
			if (channel.isHidden) {
				logger.debug('Channel is hidden', { channelId });
				return c.json({
					success: false,
					error: 'Channel not found'
				}, 404);
			}

			// Check if channel is private - only owner can access
			if (channel.isPrivate && channel.userId !== userId) {
				logger.debug('Private channel access denied', { channelId, userId });
				return c.json({
					success: false,
					error: 'Channel not found'
				}, 404);
			}

			// Get playlists from R2 bucket
			const bucket = c.env.playlists;
			type PlaylistType = z.infer<typeof BusinessPlaylist>;
			const repository = new R2Repository<PlaylistType>(bucket);

			// Bounded scan that keeps reading until the page is full (lib/listFill.ts):
			// filtering after cutting an R2 slice returned short or empty pages.
			const isOwner = Boolean(userId && channel.userId === userId);
			const scan = await scanFill<PlaylistType>({
				bucket,
				cursor,
				limit,
				load: key => repository.getObject(key),
				isListed: (playlist): playlist is PlaylistType => Boolean(playlist)
					&& playlist.channelId === channelId
					// Watch later is the user's, never a channel's playlist
					&& !isSystemPlaylist(playlist)
					// Soft-deleted and moderation-hidden playlists are never listed
					&& !playlist.isDeleted
					&& !playlist.isHidden
					// Private playlists (isPublic === false) only for the channel owner
					&& (playlist.isPublic !== false || isOwner),
				label: 'ChannelPlaylistsList',
			});

			// Sort by latest first
			const limitedPlaylists = scan.items.sort((a, b) =>
				new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime());
			const nextCursor = scan.cursor;
			const hasMore = Boolean(nextCursor);

			const response = {
				cursor: nextCursor || "",
				limit,
				data: await withPlaylistCovers(c.env, limitedPlaylists.map(toPlaylistResponse), userId),
			};

			const duration = Date.now() - startTime;
			logger.debug('Successfully fetched channel playlists', {
				channelId,
				playlistsCount: limitedPlaylists.length,
				scanned: scan.scanned,
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
