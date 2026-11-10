import { Num, Str } from "chanfana";
import { string, z } from "zod";
import { Playlist as BusinessPlaylist, Channel as BusinessChannel, PaginationResponse, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { toPlaylistResponse } from "../../lib/playlists";
import { withPlaylistCovers } from "../../lib/playlistCovers";
import { OptionalAuthRoute, AppContext } from "../../base";
import { isSystemPlaylist } from "../../lib/library";
import { playlistListIds, scheduleOwnershipHeal, waitUntilOf } from "../../lib/search/ownership";
import { pageFromIndex } from "../../lib/search/indexPage";
import { scanPage } from "../../lib/scanCursor";

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

			const bucket = c.env.playlists;
			type PlaylistType = z.infer<typeof BusinessPlaylist>;
			const repository = new R2Repository<PlaylistType>(bucket);
			const isOwner = Boolean(userId && channel.userId === userId);

			// The channel's playlists; private ones only for the channel owner
			const isListed = (playlist: PlaylistType | null): playlist is PlaylistType =>
				!!playlist &&
				playlist.channelId === channelId &&
				!playlist.isDeleted &&
				!playlist.isHidden &&
				!isSystemPlaylist(playlist) &&
				(playlist.isPublic !== false || isOwner);

			// Newest first, one keyset page of the ownership index (kind 'playlist').
			// The bucket slice it replaces missed playlists outside its window.
			const indexed = await pageFromIndex<PlaylistType>({
				cursor,
				sort: 'latest',
				limit,
				fetch: (after, pageLimit) => playlistListIds(c.env as never, { channelId, sort: 'latest', limit: pageLimit, after, privateFor: isOwner }),
				load: (id) => repository.getObject(id),
				isListed,
			});

			let limitedPlaylists: PlaylistType[];
			let nextCursor: string;
			if (indexed) {
				limitedPlaylists = indexed.items;
				nextCursor = indexed.cursor;
			} else {
				// Index unavailable: a bounded scan that keeps its place (lib/scanCursor.ts); the rebuild is queued
				if (!cursor) scheduleOwnershipHeal(c.env as never, waitUntilOf(c as never), 'playlist');
				const scanned = await scanPage<PlaylistType>({
					cursor,
					limit,
					list: async (pageCursor, pageSize) => {
						const batch = await repository.listObjects(pageSize, pageCursor);
						return { items: batch.items || [], cursor: batch.cursor || "" };
					},
					isListed,
				});
				limitedPlaylists = scanned.items.sort((a, b) => new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime());
				nextCursor = scanned.cursor;
			}
			const hasMore = !!nextCursor;

			const response = {
				cursor: nextCursor || "",
				limit,
				data: await withPlaylistCovers(c.env, limitedPlaylists.map(toPlaylistResponse), userId),
			};

			const duration = Date.now() - startTime;
			logger.debug('Successfully fetched channel playlists', {
				channelId,
				playlistsCount: limitedPlaylists.length,
				source: indexed ? 'index' : 'scan',
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
