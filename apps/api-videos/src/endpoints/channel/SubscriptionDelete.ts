import { Str } from "chanfana";
import { z } from "zod";
import { Channel, Profile, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from "../../base";
import { countSubscribers } from "../../lib/subscriptions";

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
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Extract channel ID and subscriber ID
		const { id } = request.params;
		const userId = this.getUserId(c);
		const { channelId } = request.headers;

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
			if (subscription) {
				channel.subscriptions = channel.subscriptions.filter(s => s.channelId !== channelId);

				await repository.putObject(id, channel);

				const queue = new Queue(c.env.queue);
				await queue.send(MessageType.Unsubscribe, {
					subscriptionId: subscription.id,
					targetChannelId: id,
					subscriberChannelId: channelId,
					userId: userId,
					timestamp: new Date().toISOString(),
				});
			}

			// Update reverse index on subscriber's profile
			try {
				const profileBucket = c.env.profiles;
				type ProfileType = z.infer<typeof Profile>;
				const profileRepository = new R2Repository<ProfileType>(profileBucket);
				const profile = await profileRepository.getObject(userId);

				if (profile && profile.subscribedTo) {
					// Remove target channel from subscribedTo
					const index = profile.subscribedTo.indexOf(id);
					if (index !== -1) {
						profile.subscribedTo.splice(index, 1);
						await profileRepository.putObject(userId, profile);
						logger.debug('Updated profile subscribedTo reverse index (removed)', { userId, targetChannelId: id });
					}
				}
			} catch (profileError) {
				// Log but don't fail the unsubscription - reverse index is for optimization
				logger.warn('Failed to update profile subscribedTo index:', profileError);
			}

			return c.json(
				{
					success: true,
					result: {
						channelId: id,
						isSubscribed: false,
						subscriberCount: countSubscribers(channel.subscriptions),
					},
				},
				200
			);
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

