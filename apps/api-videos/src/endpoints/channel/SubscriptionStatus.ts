import { Str } from "chanfana";
import { z } from "zod";
import { Channel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, AppContext } from "../../base";
import { isSubscribedTo, subscriberCounts } from "../../lib/subscription-store";

export class SubscriptionStatus extends OptionalAuthRoute {
	schema = {
		tags: ["Subscriptions"],
		summary: "Get the current viewer's subscription status for a channel",
		description: "Returns isSubscribed for the caller's current identity: the channel in the channelId header when one is active, otherwise the member's own (channel-less) subscription. subscriberCount counts every subscriber identity once (members and channels). Unauthenticated requests get isSubscribed=false.",
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

		// D1 for channels whose subscriptions moved there, the R2 array otherwise (AV-4)
		const channelRef = { ...channel, id };
		const [subscribed, counts] = await Promise.all([
			userId ? isSubscribedTo(c.env.NOTIFICATIONS_DB, channelRef, { userId, channelId: viewerChannelId }) : Promise.resolve(false),
			subscriberCounts(c.env.NOTIFICATIONS_DB, [channelRef]),
		]);

		logger.debug('[SubscriptionStatus] Resolved', { channelId: id, userId, viewerChannelId, subscribed });

		return {
			success: true,
			result: {
				channelId: id,
				isSubscribed: subscribed,
				subscriberCount: counts.get(id) ?? 0,
			},
		};
	}
}
