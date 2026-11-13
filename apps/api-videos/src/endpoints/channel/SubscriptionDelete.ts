import { Str } from "chanfana";
import { z } from "zod";
import { Channel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from "../../base";
import { changeSubscription, memberSubscribers, subscriberCounts, type Subscriber } from "../../lib/subscription-store";

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
		summary: "Unsubscribe from a channel",
		description: "Removes the caller's current identity's subscription: the channel in the channelId header when one is active, otherwise the member's own. With `scope=all` (the subscriptions page) removes every subscription the member has to the channel, as themselves and as any of their channels. Idempotent.",
		request: {
			params: z.object({
				id: Str({ description: "Channel ID" }),
			}),
			headers: z.object({
				// A missing header reaches the schema as null (#1139)
				channelId: Str({ description: "The caller's active channel to unsubscribe as; omit to unsubscribe as yourself" }).optional().nullable(),
			}),
			query: z.object({
				scope: z.enum(['identity', 'all']).optional().describe("identity (default): the current identity only; all: every identity of the member"),
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
		const channelId = request.headers.channelId || null;
		type ChannelType = z.infer<typeof Channel>;

		try {
		// Load the TARGET channel (route param), not the subscriber's channel (header)
		const repository = new R2Repository<ChannelType>(c.env.channels);
		const channel = await repository.getObject(id);
		if (!channel) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}

			const scope = request.query?.scope ?? 'identity';
			const subscribers: Subscriber[] = scope === 'all'
				? await memberSubscribers(c.env.NOTIFICATIONS_DB, { ...channel, id }, userId)
				: [{ userId, channelId }];
			logger.debug('[SubscriptionDelete] Unsubscribing', { targetChannelId: id, userId, scope, identities: subscribers.length, subscriberChannelId: channelId });

			let subscriberCount: number | null = null;
			const queue = new Queue(c.env.queue);
			for (const subscriber of subscribers) {
				// Atomic in D1 (SCALABILITY-AUDIT AV-4), one identity at a time
				const change = await changeSubscription(c.env, { ...channel, id }, subscriber, 'remove');
				if (!change) {
					return c.json({ success: false, error: "Object not found" }, 404);
				}
				subscriberCount = change.subscribers;
				if (change.changed) {
					await queue.send(MessageType.Unsubscribe, {
						subscriptionId: change.subscriptionId,
						targetChannelId: id,
						subscriberChannelId: subscriber.channelId ?? null,
						subscriberType: subscriber.channelId ? 'channel' : 'user',
						userId: userId,
						timestamp: new Date().toISOString(),
					});
				}
			}
			if (subscriberCount === null) {
				subscriberCount = (await subscriberCounts(c.env.NOTIFICATIONS_DB, [{ ...channel, id }])).get(id) ?? 0;
			}

			return c.json({ success: true, result: { channelId: id, isSubscribed: false, subscriberCount } }, 200);
		} catch (error) {
			logger.error("Error deleting Subscription:", error);
			return c.json({ success: false, error: "Error deleting Subscription" }, 500);
		}
	}
}
