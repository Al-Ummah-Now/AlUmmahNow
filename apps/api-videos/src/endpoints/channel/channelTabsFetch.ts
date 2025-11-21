import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { ChannelTabConfig as BusinessChannelTabConfig, Channel as BusinessChannel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { DEFAULT_CHANNEL_TABS } from '@al-ummah/shared-types';

export class ChannelTabsFetch extends OpenAPIRoute {
	schema = {
		tags: ["Channels"],
		summary: "Get channel tabs configuration",
		description: "Retrieves the tabs configuration for a channel including visibility, order, and default tab. Returns ephemeral default if none exists (not persisted).",
		request: {
			params: z.object({
				id: Str({ description: "Channel ID" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
				userId: Str({ description: "User ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns channel tabs configuration",
				content: {
					"application/json": {
						schema: BusinessChannelTabConfig,
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

	async handle(c) {
		try {
			// Get validated data
			const request = await this.getValidatedData<typeof this.schema>();

			// Retrieve the validated id
			const { id } = request.params;

			// Verify channel exists
			const channelsBucket = c.env.channels;
			type ChannelType = z.infer<typeof BusinessChannel>;
			const channelRepository = new R2Repository<ChannelType>(channelsBucket);
			const channel = await channelRepository.getObject(id);

			if (!channel) {
				return c.json(
					{
						success: false,
						error: "Channel not found",
					},
					404
				);
			}

			// Fetch tab configuration
			const tabsBucket = c.env.channel_tabs;
			type ChannelTabConfigType = z.infer<typeof BusinessChannelTabConfig>;
			const tabsRepository = new R2Repository<ChannelTabConfigType>(tabsBucket);
			let config = await tabsRepository.getObject(`channel-tabs/${id}`);

			// If no config exists, return ephemeral default (don't save to R2 on GET)
			// This prevents side effects on GET requests (P1 fix)
			if (!config) {
				const now = new Date().toISOString();
				config = {
					channelId: id,
					defaultTab: 'home',
					tabs: DEFAULT_CHANNEL_TABS,
					version: 0, // Version 0 indicates ephemeral default (not persisted)
					dateCreated: now,
					dateModified: now,
				};
			}

			return config;
		} catch (error) {
			// Add context to error before re-throwing
			const enrichedError = error instanceof Error ? error : new Error(String(error));
			enrichedError.message = `[ChannelTabsFetch] ${enrichedError.message}`;
			(enrichedError as any).channelId = (await this.getValidatedData<typeof this.schema>()).params.id;
			throw enrichedError;
		}
	}
}
