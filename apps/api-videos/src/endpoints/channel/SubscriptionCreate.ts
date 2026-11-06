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
		const data = await this.getValidatedData<typeof this.schema>();

		// Extract channel ID and subscriber ID
		const { id } = data.params;
		const userId = this.getUserId(c);
		const { channelId } = data.headers;

		// Implement your own object insertion here
		try {
			const bucket = c.env.channels;
			type ChannelType = z.infer<typeof Channel>;
			const repository = new R2Repository<ChannelType>(bucket);
			// Load the TARGET channel (route param), not the subscriber's channel (header)
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

			if (id === channelId) {
				return c.json(
					{
						success: false,
						error: "Cannot subscribe to your own channel",
					},
					400
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

			// Check if the user has already subscribed to the channel
			const alreadySubscribed = channel.subscriptions.find((s) => s.channelId === subscription.channelId);
			if (alreadySubscribed) {
				return c.json(
					{
						success: true,
						result: {
							channelId: id,
							isSubscribed: true,
							subscriberCount: countSubscribers(channel.subscriptions),
						},
					},
					200
				);
			}

			channel.subscriptions.push(subscription);
			await repository.putObject(id, channel);

			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.Subscribe, {
				subscriptionId: subscription.id,
				targetChannelId: id,
				subscriberChannelId: channelId,
				userId: userId,
				timestamp: new Date().toISOString(),
			});

			// Update reverse index on subscriber's profile
			try {
				const profileBucket = c.env.profiles;
				type ProfileType = z.infer<typeof Profile>;
				const profileRepository = new R2Repository<ProfileType>(profileBucket);
				const profile = await profileRepository.getObject(userId);

				if (profile) {
					if (!profile.subscribedTo) {
						profile.subscribedTo = [];
					}
					// Add target channel to subscribedTo if not already there
					if (!profile.subscribedTo.includes(id)) {
						profile.subscribedTo.push(id);
						await profileRepository.putObject(userId, profile);
						logger.debug('Updated profile subscribedTo reverse index', { userId, targetChannelId: id });
					}
				}
			} catch (profileError) {
				// Log but don't fail the subscription - reverse index is for optimization
				logger.warn('Failed to update profile subscribedTo index:', profileError);
			}

			return c.json(
				{
					success: true,
					result: {
						channelId: id,
						isSubscribed: true,
						subscriberCount: countSubscribers(channel.subscriptions),
					},
				},
				201
			);
		}
		catch (error) {
			logger.error("Error fetching Channel:", error);
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
