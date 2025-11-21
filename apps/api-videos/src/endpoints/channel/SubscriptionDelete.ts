import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Channel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';

export class SubscriptionDelete extends OpenAPIRoute {
	schema = {
		tags: ["Subscriptions"],
		summary: "Unsubscripe from a channel",
		request: {
			params: z.object({
				id: Str({ description: "Channel ID" }),
				cid: Str({ description: "Subscriber ID" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
				userId: Str({ description: "User ID" }),
			}),
		},
		responses: {
			"201": {
				description: "Subscription deleted successfully",
				content: {
					"application/json": {
						schema: Channel,
					},
				},
			},
			"404": {
				description: "Profile not found",
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
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Extract channel ID and subscriber ID
		const { id, cid } = request.params;
		const { channelId, userId } = request.headers;

		// Implement your own object insertion here
		try {
			const bucket = c.env.channels;
			type ChannelType = z.infer<typeof Channel>;
			const repository = new R2Repository<ChannelType>(bucket);
			let channel = await repository.getObject(id);

			const exists = channel !== null;

			if (!exists) {
				return Response.json(
					{
						success: false,
						error: "Object not found",
					},
					{
						status: 404,
					},
				);
			}

			if (!channel.subscriptions) {
				channel.subscriptions = [];
			}

			const subscription = channel.subscriptions.find(s => s.channelId === channelId);
			channel.subscriptions = channel.subscriptions.filter(s => s.channelId !== channelId);
						
			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.Unsubscribe, {
				subscriptionId: subscription.id,
				targetChannelId: id,
				subscriberChannelId: channelId,
				userId: userId,
				timestamp: new Date().toISOString(),
			});

			await repository.putObject(id, channel);

			return channel;
		}
		catch (error) {
			logger.error("Error fetching Profile:", error);
			return Response.json(
				{
					success: false,
					error: "Error creating Subscription",
				},
				{
					status: 500,
				},
			);
		}
	}
}

