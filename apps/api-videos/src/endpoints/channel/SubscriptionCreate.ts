import { Str } from "chanfana";
import { z } from "zod";
import { Channel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';
import { inBackground, notifyUser } from '../../lib/websocket-notify';
import { AuthenticatedRoute, AppContext } from "../../base";
import { changeSubscription } from "../../lib/subscription-store";

const SubscriptionStatusResponse = z.object({
	success: z.boolean(),
	result: z.object({
		channelId: z.string(),
		isSubscribed: z.boolean(),
		subscriberCount: z.number(),
	}),
});

export class SubscriptionCreate extends AuthenticatedRoute {
	schema = {
		tags: ["Subscriptions"],
		summary: "Subscripe to a channel",
		request: {
			params: z.object({
				id: Str({ description: "Channel ID" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
			}),
		},
		responses: {
			"201": {
				description: "Subscription created successfully",
				content: {
					"application/json": {
						schema: SubscriptionStatusResponse,
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
			"403": {
				description: "The channelId header is not one of the caller's channels",
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
		const data = await this.getValidatedData<typeof this.schema>();
		const { id } = data.params;
		const userId = this.getUserId(c);
		const { channelId } = data.headers;
		type ChannelType = z.infer<typeof Channel>;

		try {
		// Load the TARGET channel (route param), not the subscriber's channel (header)
		const repository = new R2Repository<ChannelType>(c.env.channels);
		const channel = await repository.getObject(id);
		if (!channel) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}

			if (id === channelId) {
				return c.json({ success: false, error: "Cannot subscribe to your own channel" }, 400);
			}

			// A member subscribes as one of their own channels, never as someone else's
			const subscriberChannel = await repository.getObject(channelId);
			if (!subscriberChannel || subscriberChannel.userId !== userId) {
				return c.json({ success: false, error: "You can only subscribe as one of your own channels" }, 403);
			}

			// Atomic in D1 (SCALABILITY-AUDIT AV-4): concurrent subscribers all count
			const change = await changeSubscription(c.env, { ...channel, id }, { userId, channelId }, 'add');
			if (!change) {
				return c.json({ success: false, error: "Object not found" }, 404);
			}
			const result = { channelId: id, isSubscribed: true, subscriberCount: change.subscribers };
			if (!change.changed) {
				return c.json({ success: true, result }, 200);
			}

			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.Subscribe, {
				subscriptionId: change.subscriptionId,
				targetChannelId: id,
				subscriberChannelId: channelId,
				userId: userId,
				timestamp: new Date().toISOString(),
			});

			// Realtime: tell the subscribed-to channel's owner (after the response)
			inBackground(c, 'new-subscriber', async () => {
				if (channel.userId && channel.userId !== userId) {
					await notifyUser(c.env, channel.userId, {
						notificationType: 'subscription',
						notificationKey: 'newSubscriber',
						params: { channelName: channel.name || '' },
						actionUrl: `/channel/${id}`,
					});
				}
			});

			return c.json({ success: true, result }, 201);
		} catch (error) {
			logger.error("Error creating Subscription:", error);
			return c.json({ success: false, error: "Error creating Subscription" }, 500);
		}
	}
}
