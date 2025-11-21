import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { ChannelView } from "../../lib/model/view";
import { transformChannelToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class ChannelFetch extends OpenAPIRoute {
	schema = {
		tags: ["Channels"],
		summary: "Get a single Channel by id",
		request: {
			params: z.object({
				id: Str({ description: "Channel id" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
				userId: Str({ description: "User ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a single Channel if found",
				content: {
					"application/json": {
						schema: ChannelView,
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

	async handle(c) {
		try {
			// Get validated data
			const request = await this.getValidatedData<typeof this.schema>();

			// Retrieve the validated id
			const { id } = request.params;
			const { channelId, userId } = request.headers;

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

			// Transform to view model for response
			const channelView = transformChannelToView(channel);

			// Send queue message for channel view analytics
			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.ChannelView, {
				channelId: channel.id,
				userId,
				requestChannelId: channelId,
				timestamp: new Date().toISOString(),
			});

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
