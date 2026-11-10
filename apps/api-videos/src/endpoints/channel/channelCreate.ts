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
import { ownerContentIds, scheduleOwnershipHeal, waitUntilOf } from "../../lib/search/ownership";

type StoredChannel = z.infer<typeof BusinessChannel>;

/** Pages of the bucket scan used while the ownership index is incomplete. */
// A uniqueness guard, so it gets more of the budget than other fallbacks; still
// bounded below the subrequest limit (SCALABILITY-AUDIT AV-16)
const DUPLICATE_SCAN_MAX_PAGES = 8;

function sameName(channel: StoredChannel | null, userId: string, wantedName: string): boolean {
	return !!channel && channel.userId === userId && !channel.isDeleted
		&& String(channel.name ?? "").trim().toLocaleLowerCase() === wantedName;
}

/**
 * Whether `userId` already owns a not-deleted channel named `wantedName`
 * (trimmed, lower-cased; moderation-hidden channels count).
 *
 * Reads the owner's channel ids from the ownership index, so the cost grows
 * with that owner's channels. Only while the index is incomplete (or D1 is
 * unavailable) does it fall back to scanning the bucket, which reads every
 * channel object, and schedule a heal so later creates use the index.
 */
export async function ownerHasChannelNamed(
	c: AppContext,
	repository: R2Repository<StoredChannel>,
	userId: string,
	wantedName: string,
): Promise<boolean> {
	const ids = await ownerContentIds(c.env as never, "channel", userId);
	if (ids) {
		const owned = await Promise.all(ids.map((id) => repository.getObject(id)));
		return owned.some((ch) => sameName(ch, userId, wantedName));
	}

	scheduleOwnershipHeal(c.env as never, waitUntilOf(c as never), "channel");
	let cursor: string | undefined;
	for (let page = 0; page < DUPLICATE_SCAN_MAX_PAGES; page++) {
		const batch = await repository.listObjects(100, cursor);
		if ((batch.items || []).some((ch) => sameName(ch, userId, wantedName))) return true;
		if (!batch.cursor) return false;
		cursor = batch.cursor;
	}
	return false;
}

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
		// submits and accidental duplicates).
		const wantedName = String(channelInput.name ?? "").trim().toLocaleLowerCase();
		if (wantedName) {
			const existingRepo = new R2Repository<StoredChannel>(c.env.channels);
			if (await ownerHasChannelNamed(c, existingRepo, userId, wantedName)) {
				return c.json({ success: false, error: "You already have a channel with this name" }, 409);
			}
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
