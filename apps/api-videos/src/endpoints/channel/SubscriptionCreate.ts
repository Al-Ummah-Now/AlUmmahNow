import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Channel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class SubscriptionCreate extends OpenAPIRoute {
	schema = {
		tags: ["Subscriptions"],
		summary: "Subscripe to a channel",
		request: {
			params: z.object({
				id: Str({ description: "Channel ID" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
				userId: Str({ description: "User ID" }),
			}),
		},
		responses: {
			"201": {
				description: "Subscription created successfully",
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
		const data = await this.getValidatedData<typeof this.schema>();

		// Extract channel ID and subscriber ID
		const { id } = data.params;
		const { channelId, userId } = data.headers;

		// Implement your own object insertion here
		try {
			const bucket = c.env.channels;
			type ChannelType = z.infer<typeof Channel>;
			const repository = new R2Repository<ChannelType>(bucket);
			let channel = await repository.getObject(channelId);

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

			if (!channel.subscriptions) {
				channel.subscriptions = [];
			}

			// Add the subscription to the channel
			const subscription = {
				id: crypto.randomUUID(),
				userId: userId,
				channelId: channelId,
				entityId: id,
				dateCreated: new Date().toISOString(),
			};
			
			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.Subscribe, {
				subscriptionId: subscription.id,
				targetChannelId: id,
				subscriberChannelId: channelId,
				userId: userId,
				timestamp: new Date().toISOString(),
			});

			// Check if the user has already subscriped the video
			const alreadySubscribed = channel.subscriptions.find((s) => s.channelId === subscription.channelId);
			if (alreadySubscribed) {
				return c.json(
					{
						success: true,
						error: "Already Subscribed",
					},
					201
				);
			}

			channel.subscriptions.push(subscription);
			await repository.putObject(id, channel);

			return channel;
		}
		catch (error) {
			console.error("Error fetching Channel:", error);
			return c.json(
				{
					success: false,
					error: "Error creating Subscription",
				},
				500
			);
		}
	}
}
