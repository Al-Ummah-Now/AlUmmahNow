import { Str } from "chanfana";
import { z } from "zod";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { PublicChannelView } from "../../lib/model/view";
import { toPublicChannels } from "../../lib/public-views";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from "../../base";
import { GONE_BODY, isPurged } from '../../lib/gone';
import { edgeCacheUrl, readEdgeCache, writeEdgeCache } from '../../lib/edge-cache';
import { waitUntilOf } from '../../lib/search/ownership';

/**
 * Anonymous channel reads (every channel page's server render, twice: metadata and page) are kept per
 * colo this long. Signed-in viewers always read R2: the owner sees their own edits at once.
 */
export const CHANNEL_VIEW_TTL_SECONDS = 30;

export class ChannelFetch extends OptionalAuthRoute {
	schema = {
		tags: ["Channels"],
		summary: "Get a single Channel by id",
		request: {
			params: z.object({
				id: Str({ description: "Channel id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a single Channel if found",
				content: {
					"application/json": {
						schema: PublicChannelView,
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
			"400": {
				description: "Bad request - invalid input data",
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
		try {
			// Get validated data
			const request = await this.getValidatedData<typeof this.schema>();

			// Retrieve the validated id
			const { id } = request.params;
			const userId = this.getUserId(c);
			const cacheUrl = userId ? null : edgeCacheUrl(c.req.url, `channel-view/${encodeURIComponent(id)}`);
			if (cacheUrl) {
				const hit = await readEdgeCache<z.infer<typeof PublicChannelView>>(cacheUrl);
				if (hit) return hit;
			}

			// Implement your own object fetch here
			const bucket = c.env.channels;
			type ChannelType = z.infer<typeof BusinessChannel>;
			const repository = new R2Repository<ChannelType>(bucket);
			let channel = await repository.getObject(id);

			const exists = channel !== null;

			if (!exists) {
				// Purged (deleted, then removed for good): 410 (lib/gone.ts)
				if (await isPurged(c.env as never, 'channel', id)) return c.json(GONE_BODY, 410);
				return c.json(
					{
						success: false,
						error: "Object not found",
					},
					404
				);
			}

			// Check if channel is deleted (soft delete)
			if (channel.isDeleted) {
				return c.json(
					{
						success: false,
						error: "Object not found",
					},
					404
				);
			}

			// Check if channel is hidden (moderation) - blocks everyone including owner
			if (channel.isHidden) {
				return c.json(
					{
						success: false,
						error: "Object not found",
					},
					404
				);
			}

			// Check if channel is private - only owner can access
			if (channel.isPrivate && channel.userId !== userId) {
				return c.json(
					{
						success: false,
						error: "Object not found",
					},
					404
				);
			}

			// Transform to view model for response
			const [channelView] = await toPublicChannels(c.env.NOTIFICATIONS_DB, [channel], c.env as never);

			// videosCount comes from the ownership index (toPublicChannels): uploads
			// don't append to channel.videos.

			// No queue message per channel read: the processor only logged it (and
			// rejected anonymous ones), at the cost of queue operations per page load.

			// Only a channel everyone may see is stored (private ones already returned 404 above)
			if (cacheUrl && channelView) writeEdgeCache(cacheUrl, channelView, CHANNEL_VIEW_TTL_SECONDS, waitUntilOf(c as never));
			return channelView;
		} catch (error) {
			// Add context to error before re-throwing
			const enrichedError = error instanceof Error ? error : new Error(String(error));
			enrichedError.message = `[ChannelFetch] ${enrichedError.message}`;
			(enrichedError as any).channelId = (await this.getValidatedData<typeof this.schema>()).params.id;
			throw enrichedError;
		}
	}
}
