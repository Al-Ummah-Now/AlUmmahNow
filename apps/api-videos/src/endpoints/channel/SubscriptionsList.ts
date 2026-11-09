import { Str, Int } from "chanfana";
import { z } from "zod";
import { Channel, Profile, ResponseError } from "../../lib/types";
import { PublicChannelView } from "../../lib/model/view";
import { toPublicChannels } from "../../lib/public-views";
import { subscribedChannelIds } from "../../lib/subscription-store";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from "../../base";

// Response schema for subscription list
const SubscriptionsListResponse = z.object({
	success: z.boolean(),
	data: z.array(PublicChannelView),
	total: z.number(),
	page: z.number(),
	pageSize: z.number(),
});

export class SubscriptionsList extends AuthenticatedRoute {
	schema = {
		tags: ["Subscriptions"],
		summary: "List channels the current user is subscribed to",
		description: "Returns a paginated list of channels the authenticated user is subscribed to, using the reverse index for efficient lookup.",
		request: {
			query: z.object({
				page: Int({ description: "Page number (1-indexed)" }).default(1),
				pageSize: Int({ description: "Number of items per page" }).default(20),
			}),
		},
		responses: {
			"200": {
				description: "List of subscribed channels",
				content: {
					"application/json": {
						schema: SubscriptionsListResponse,
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
		const userId = this.getUserId(c);
		const { page, pageSize } = data.query;

		try {
			// Get user's profile to access subscribedTo array
			const profileBucket = c.env.profiles;
			type ProfileType = z.infer<typeof Profile>;
			const profileRepository = new R2Repository<ProfileType>(profileBucket);
			const profile = await profileRepository.getObject(userId);

			if (!profile) {
				return c.json(
					{
						success: false,
						error: "Profile not found",
					},
					404
				);
			}

			// D1 subscriptions plus legacy entries of channels not imported yet (AV-4/AV-6)
			const subscribedTo = await subscribedChannelIds(c.env.NOTIFICATIONS_DB, userId, profile.subscribedTo);
			const total = subscribedTo.length;

			// Calculate pagination
			const startIndex = (page - 1) * pageSize;
			const endIndex = Math.min(startIndex + pageSize, total);
			const paginatedIds = subscribedTo.slice(startIndex, endIndex);

			// Fetch channel details for each subscription
			const channelBucket = c.env.channels;
			type ChannelType = z.infer<typeof Channel>;
			const channelRepository = new R2Repository<ChannelType>(channelBucket);

			const channels: ChannelType[] = [];
			for (const channelId of paginatedIds) {
				try {
					const channel = await channelRepository.getObject(channelId);
					if (channel) {
						channels.push(channel);
					}
				} catch (err) {
					logger.warn('Failed to fetch subscribed channel', { channelId, error: err });
				}
			}

			return c.json({
				success: true,
				data: await toPublicChannels(c.env.NOTIFICATIONS_DB, channels),
				total,
				page,
				pageSize,
			});
		} catch (error) {
			logger.error("Error listing subscriptions:", error);
			return c.json(
				{
					success: false,
					error: "Error listing subscriptions",
				},
				500
			);
		}
	}
}
