import { Bool, Str } from "chanfana";
import R2Repository from "../../lib/r2Repo";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { z } from "zod";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";
import { Profile as BusinessProfile } from "../../lib/types";
import { releaseHandle } from "../../lib/channelHandles";
import { pickNewMainChannel, removeChannelContent, OwnedChannelSummary } from "../../lib/channelDeletion";
import { loadOwnedChannels } from "../../lib/analytics";
import { inBackground } from "../../lib/websocket-notify";
import { logger } from "../../lib/logger";

export class ChannelDelete extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Delete a Channel",
		request: {
			params: z.object({
				id: Str({ description: "Channel ID" }),
			}),
			query: z.object({
				newMainChannelId: Str({ required: false, description: "When deleting the main channel: which remaining channel becomes main (default: the oldest)" }),
			}),
		},
		responses: {
			"200": {
				description: "Returns if the Channel was deleted successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								deletedChannelId: Str(),
								newMainChannelId: Str().nullable().describe("Set when the deleted channel was the main channel and another channel was promoted"),
							}).optional(),
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
			"403": {
				description: "Forbidden - user does not own this channel",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"404": {
				description: "Channel not found",
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

		// Retrieve the validated id
		const { id } = request.params;
		const userId = this.getUserId(c);

		// Get the channel before deletion
		const bucket = c.env.channels;
		type ChannelType = z.infer<typeof BusinessChannel>;
		const repository = new R2Repository<ChannelType>(bucket);
		
		let channel = await repository.getObject(id);
		if (!channel) {
			return c.json({
				success: false,
				error: "Channel not found",
			}, 404);
		}

		// Verify user owns this channel
		if (channel.userId !== userId) {
			return c.json({
				success: false,
				error: "You do not have permission to delete this channel",
			}, 403);
		}

		// Send queue message for channel deletion
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.ChannelDelete, {
			channelId: id,
			userId: userId,
			timestamp: new Date().toISOString(),
		});

		// Main-channel rule (see lib/channelDeletion.ts): promote another channel
		let newMainChannelId: string | null = null;
		if (channel.isMain) {
			const owned = (await loadOwnedChannels(bucket, userId)) as unknown as OwnedChannelSummary[];
			const next = pickNewMainChannel(owned, id, c.req.query('newMainChannelId'));
			if (next) {
				// Conditional write on the fresh channel (SCALABILITY-AUDIT AV-5)
				const promoted = await repository.updateObject(next.id, (nextChannel) => {
					nextChannel.isMain = true;
					nextChannel.dateModified = new Date().toISOString();
				});
				if (promoted) newMainChannelId = next.id;
			}
		}

		// Delete the channel and free its @handle
		await repository.deleteObject(id);
		try {
			await releaseHandle(c.env.channel_tabs, channel.handle, id);
			await c.env.channel_tabs.delete(`channel-tabs/${id}`);
		} catch (error) {
			logger.warn('[ChannelDelete] Could not release handle/tabs', { channelId: id, error: error instanceof Error ? error.message : String(error) });
		}

		// Drop the channel from the owner's profile
		try {
			type ProfileType = z.infer<typeof BusinessProfile>;
			const profileRepo = new R2Repository<ProfileType>(c.env.profiles);
			// Conditional write on the fresh profile (SCALABILITY-AUDIT AV-6)
			await profileRepo.updateObject(userId, (profile) => {
				if (!profile.channels?.includes(id)) return false;
				profile.channels = profile.channels.filter((cid) => cid !== id);
				return true;
			});
		} catch (error) {
			logger.warn('[ChannelDelete] Could not update profile channels', { channelId: id, error: error instanceof Error ? error.message : String(error) });
		}

		// Videos, playlists, posts and sections go after the response
		inBackground(c, `channel-delete:${id}`, () => removeChannelContent(c.env, id));

		logger.info('[ChannelDelete] Channel deleted', { channelId: id, userId, wasMain: channel.isMain === true, newMainChannelId });

		return {
			success: true,
			result: { deletedChannelId: id, newMainChannelId },
		};
	}
}
