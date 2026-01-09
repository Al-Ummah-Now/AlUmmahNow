import { Bool } from "chanfana";
import { z } from "zod";
import { Channel as BusinessChannel, Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { ChannelInput } from "../../lib/model/input";
import { ChannelView } from "../../lib/model/view";
import { transformChannelToView, createEntityDefaults } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";

export class ChannelCreate extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Create a new Channel",
		request: {
			body: {
				content: {
					"application/json": {
						schema: ChannelInput,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the created Channel",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								channel: ChannelView,
							}),
						}),
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

		// Retrieve the validated request body
		const channelInput = request.body;
		const userId = this.getUserId(c);

		// Get user's email from profile
		const profileBucket = c.env.profiles;
		type ProfileType = z.infer<typeof BusinessProfile>;
		const profileRepository = new R2Repository<ProfileType>(profileBucket);
		const userProfile = await profileRepository.getObject(userId);
		
		if (!userProfile) {
			return c.json({
				success: false,
				error: "User profile not found",
			}, 404);
		}

		// Create business channel object
		const entityDefaults = createEntityDefaults();

		const businessChannel = {
			...entityDefaults,
			userId: userId,
			email: userProfile.email,
			name: channelInput.name,
			nameLocalized: channelInput.nameLocalized,
			description: channelInput.description,
			descriptionLocalized: channelInput.descriptionLocalized,
			isMain: channelInput.isMain || false,
			avatarUrl: channelInput.avatarUrl,
			coverUrl: channelInput.coverUrl,
			playlists: [],
			videos: [],
			subscribers: [],
			subscriptions: [],
			likes: [],
		};

		// Implement your own object insertion here
        const bucket = c.env.channels;
		type ChannelType = z.infer<typeof BusinessChannel>;
		const repository = new R2Repository<ChannelType>(bucket);
		await repository.putObject(businessChannel.id, businessChannel);

		// Send queue message for channel creation
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.ChannelCreate, {
			channelId: businessChannel.id,
			userId: userId,
			timestamp: new Date().toISOString(),
		});

		// Transform to view model for response
		const channelView = transformChannelToView(businessChannel);

		// Return the new Channel
		return {
			success: true,
			result: {
				channel: channelView,
			},
		};
	}
}
