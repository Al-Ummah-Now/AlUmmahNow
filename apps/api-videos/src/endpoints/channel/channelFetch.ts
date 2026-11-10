import { Str } from "chanfana";
import { z } from "zod";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { PublicChannelView } from "../../lib/model/view";
import { toPublicChannels } from "../../lib/public-views";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from "../../base";
import { channelTotalsFromIndex } from "../../lib/search/ownership";
import { logger } from "../../lib/logger";

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

			// Implement your own object fetch here
			const bucket = c.env.channels;
			type ChannelType = z.infer<typeof BusinessChannel>;
			const repository = new R2Repository<ChannelType>(bucket);
			let channel = await repository.getObject(id);

			const exists = channel !== null;

			if (!exists) {
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
			const [channelView] = await toPublicChannels(c.env.NOTIFICATIONS_DB, [channel]);

			// Uploads don't append to channel.videos, so count from the ownership
			// index (public, published videos; same rule as /about). Index
			// unavailable or incomplete: keep the stored count.
			const totals = await channelTotalsFromIndex(c.env as never, channel.id).catch((error) => {
				logger.warn('[ChannelFetch] Video count from index failed', { channelId: channel.id, error: error instanceof Error ? error.message : String(error) });
				return null;
			});
			if (totals) channelView.videosCount = totals.videosCount;

			// No queue message per channel read: the processor only logged it (and
			// rejected anonymous ones), at the cost of queue operations per page load.

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
