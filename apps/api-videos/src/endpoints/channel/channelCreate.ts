import { Bool } from "chanfana";
import { z } from "zod";
import { Channel as BusinessChannel, Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { ChannelInput } from "../../lib/model/input";
import { ChannelView } from "../../lib/model/view";
import { transformChannelToView, createEntityDefaults } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";
import { claimDefaultHandle } from "../../lib/channelHandles";
import { logger } from "../../lib/logger";
import { checkNumericLimit } from "@al-ummah/shared-types";
import { getEntitlements, requestLanguage, upgradeRequiredBody } from "../../lib/entitlements";

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

		// One owner may not have two channels with the same name (guards double
		// submits and accidental duplicates). Channel creation is rare, so a
		// bounded scan of the bucket is acceptable here.
		const wantedName = String(channelInput.name ?? "").trim().toLocaleLowerCase();
		const existingRepo = new R2Repository<z.infer<typeof BusinessChannel>>(c.env.channels);
		let ownedChannels = 0;
		let cursor: string | undefined;
		for (let page = 0; page < 50; page++) {
			const batch = await existingRepo.listObjects(100, cursor);
			const owned = (batch.items || []).filter((ch) => ch.userId === userId && !ch.isDeleted);
			ownedChannels += owned.length;
			if (wantedName && owned.some((ch) => String(ch.name ?? "").trim().toLocaleLowerCase() === wantedName)) {
				return c.json({ success: false, error: "You already have a channel with this name" }, 409);
			}
			if (!batch.cursor) break;
			cursor = batch.cursor;
		}

		// A limit only blocks a new channel; channels above it are kept.
		const snapshot = await getEntitlements(c.env, [{ type: "user", id: userId }]);
		const channelLimit = checkNumericLimit(snapshot.entitlements["channel.max"].value, ownedChannels, 1);
		if (!channelLimit.allowed) {
			logger.info("[ChannelCreate] Channel limit reached", { userId, ownedChannels, limit: channelLimit.limit });
			return c.json(upgradeRequiredBody("channel.max", channelLimit.limit, ownedChannels, requestLanguage(c.req.header("Accept-Language"))), 402);
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
		// Every new channel gets a default @handle the owner can change in settings
		let handle: string | undefined;
		try {
			handle = (await claimDefaultHandle(c.env.channel_tabs, businessChannel)) || undefined;
		} catch (error) {
			logger.warn('[ChannelCreate] Default handle not assigned', { channelId: businessChannel.id, error: error instanceof Error ? error.message : String(error) });
		}
		const storedChannel = { ...businessChannel, ...(handle ? { handle } : {}) };
		await repository.putObject(businessChannel.id, storedChannel);

		// Send queue message for channel creation
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.ChannelCreate, {
			channelId: businessChannel.id,
			userId: userId,
			timestamp: new Date().toISOString(),
		});

		// Transform to view model for response
		const channelView = transformChannelToView(storedChannel);

		// Return the new Channel
		return {
			success: true,
			result: {
				channel: channelView,
			},
		};
	}
}
