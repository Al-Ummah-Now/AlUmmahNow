import { Str } from "chanfana";
import { z } from "zod";
import { Channel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from "../../base";
import { countSubscribers, isSubscribed } from "../../lib/subscriptions";

export class SubscriptionStatus extends OptionalAuthRoute {
	schema = {
		tags: ["Subscriptions"],
		summary: "Get the current viewer's subscription status for a channel",
		description: "Returns isSubscribed for the authenticated user (scoped to the channelId header when present) and the channel's subscriber count. Unauthenticated requests get isSubscribed=false.",
		request: {
			params: z.object({
				id: Str({ description: "Target channel ID" }),
			}),
		},
		responses: {
			"200": {
				description: "Subscription status",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								channelId: z.string(),
								isSubscribed: z.boolean(),
								subscriberCount: z.number(),
							}),
						}),
					},
				},
			},
			"404": {
				description: "Channel not found",
				content: { "application/json": { schema: ResponseError } },
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { id } = data.params;
		const userId = this.getUserId(c);
		// channelIdMiddleware has already verified that the header belongs to the user
		const viewerChannelId = userId ? c.req.header('channelId') : undefined;

		type ChannelType = z.infer<typeof Channel>;
		const repository = new R2Repository<ChannelType>(c.env.channels);
		const channel = await repository.getObject(id);

		if (!channel || channel.isDeleted || channel.isHidden) {
			return c.json({ success: false, error: "Channel not found" }, 404);
		}

		const subscribed = userId
			? isSubscribed(channel.subscriptions, { userId, channelId: viewerChannelId })
			: false;

		logger.debug('[SubscriptionStatus] Resolved', { channelId: id, userId, viewerChannelId, subscribed });

		return {
			success: true,
			result: {
				channelId: id,
				isSubscribed: subscribed,
				subscriberCount: countSubscribers(channel.subscriptions),
			},
		};
	}
}
