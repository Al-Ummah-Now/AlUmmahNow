import { Str } from "../../lib/chanfana-params";
import { z } from "zod";
import { ChannelTabConfig as BusinessChannelTabConfig, Channel as BusinessChannel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { DEFAULT_CHANNEL_TABS } from '@al-ummah/shared-types';
import { OptionalAuthRoute, AppContext } from "../../base";
import { channelTabCounts } from "../../lib/channelTabCounts";

export class ChannelTabsFetch extends OptionalAuthRoute {
	schema = {
		tags: ["Channels"],
		summary: "Get channel tabs configuration",
		description: "Retrieves the tabs configuration for a channel including visibility, order, and default tab, plus `counts`: public items per content tab (indexed reads), so the page can hide empty tabs from visitors. Returns ephemeral default if none exists (not persisted).",
		request: {
			params: z.object({
				id: Str({ description: "Channel ID" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
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

	async handle(c: AppContext) {
		try {
			// Get validated data
			const request = await this.getValidatedData<typeof this.schema>();

			// Retrieve the validated id
			const { id } = request.params;

			// The channel (it must exist) and its tab configuration, read together
			type ChannelType = z.infer<typeof BusinessChannel>;
			type ChannelTabConfigType = z.infer<typeof BusinessChannelTabConfig>;
			const channelRepository = new R2Repository<ChannelType>(c.env.channels);
			const tabsRepository = new R2Repository<ChannelTabConfigType>(c.env.channel_tabs);
			// Counts (indexed reads) alongside the two objects: the page hides empty tabs from visitors (#1669)
			const [channel, stored, counts] = await Promise.all([
				channelRepository.getObject(id),
				tabsRepository.getObject(`channel-tabs/${id}`),
				channelTabCounts(c.env as never, id),
			]);
			let config = stored;

			if (!channel) {
				return c.json(
					{
						success: false,
						error: "Channel not found",
					},
					404
				);
			}

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

			// Counts are never stored with the config (PUT keeps its own fields)
			return counts ? { ...config, counts } : config;
		} catch (error) {
			// Add context to error before re-throwing
			const enrichedError = error instanceof Error ? error : new Error(String(error));
			enrichedError.message = `[ChannelTabsFetch] ${enrichedError.message}`;
			(enrichedError as any).channelId = (await this.getValidatedData<typeof this.schema>()).params.id;
			throw enrichedError;
		}
	}
}
