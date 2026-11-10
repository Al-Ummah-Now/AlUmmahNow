import { Str } from "chanfana";
import { z } from "zod";
import { Channel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';
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

export class SubscriptionDelete extends AuthenticatedRoute {
	schema = {
		tags: ["Subscriptions"],
		summary: "Unsubscripe from a channel",
		request: {
			params: z.object({
				id: Str({ description: "Channel ID" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
			}),
		},
		responses: {
			"200": {
				description: "Subscription deleted successfully",
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
		const request = await this.getValidatedData<typeof this.schema>();
		const { id } = request.params;
		const userId = this.getUserId(c);
		const { channelId } = request.headers;
		type ChannelType = z.infer<typeof Channel>;

		try {
		// Load the TARGET channel (route param), not the subscriber's channel (header)
		const repository = new R2Repository<ChannelType>(c.env.channels);
		const channel = await repository.getObject(id);
		if (!channel) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}

			// Atomic in D1 (SCALABILITY-AUDIT AV-4)
			const change = await changeSubscription(c.env, { ...channel, id }, { userId, channelId }, 'remove');
			if (!change) {
				return c.json({ success: false, error: "Object not found" }, 404);
			}

			if (change.changed) {
				const queue = new Queue(c.env.queue);
				await queue.send(MessageType.Unsubscribe, {
					subscriptionId: change.subscriptionId,
					targetChannelId: id,
					subscriberChannelId: channelId,
					userId: userId,
					timestamp: new Date().toISOString(),
				});
			}

			return c.json({ success: true, result: { channelId: id, isSubscribed: false, subscriberCount: change.subscribers } }, 200);
		} catch (error) {
			logger.error("Error deleting Subscription:", error);
			return c.json({ success: false, error: "Error deleting Subscription" }, 500);
		}
	}
}
