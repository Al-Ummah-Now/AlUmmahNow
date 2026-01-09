import { Bool, Str } from "chanfana";
import { z } from "zod";
import {
	ChannelTabConfig as BusinessChannelTabConfig,
	ChannelTabConfigUpdateInput,
	Channel as BusinessChannel,
	ResponseError
} from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { DEFAULT_CHANNEL_TABS } from '@al-ummah/shared-types';
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from "../../base";

export class ChannelTabsUpdate extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Update channel tabs configuration",
		description: "Updates tab visibility, order, and default tab. Owner-only access.",
		request: {
			params: z.object({
				id: Str({ description: "Channel ID" }),
			}),
			body: {
				content: {
					"application/json": {
						schema: ChannelTabConfigUpdateInput,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Tabs configuration updated successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								config: BusinessChannelTabConfig,
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
			"403": {
				description: "Forbidden - not channel owner",
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
			"409": {
				description: "Conflict - configuration was modified by another request",
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

		// Retrieve the validated request body
		const tabsUpdateInput = request.body;

		// Verify channel exists and ownership
		const channelsBucket = c.env.channels;
		type ChannelType = z.infer<typeof BusinessChannel>;
		const channelRepository = new R2Repository<ChannelType>(channelsBucket);
		const channel = await channelRepository.getObject(id);

		if (!channel) {
			return c.json({
				success: false,
				error: "Channel not found",
			}, 404);
		}

		// Verify ownership
		if (channel.userId !== userId) {
			return c.json({
				success: false,
				error: "You can only update tabs for your own channel",
			}, 403);
		}

		// Get existing configuration or create default
		const tabsBucket = c.env.channel_tabs;
		type ChannelTabConfigType = z.infer<typeof BusinessChannelTabConfig>;
		const tabsRepository = new R2Repository<ChannelTabConfigType>(tabsBucket);
		let config = await tabsRepository.getObject(`channel-tabs/${id}`);

		// Store expected version for optimistic locking
		const expectedVersion = config?.version || 0;

		if (!config) {
			// Create default config if doesn't exist
			const now = new Date().toISOString();
			config = {
				channelId: id,
				defaultTab: 'home',
				tabs: DEFAULT_CHANNEL_TABS,
				version: 1,
				dateCreated: now,
				dateModified: now,
			};
		}

		// Validate tab positions before applying updates (P2 fix)
		const MAX_TABS = 20;
		if (tabsUpdateInput.tabs && tabsUpdateInput.tabs.length > 0) {
			for (const update of tabsUpdateInput.tabs) {
				if (update.position !== undefined && (update.position < 0 || update.position > MAX_TABS)) {
					return c.json({
						success: false,
						error: `Invalid position: ${update.position}. Must be between 0 and ${MAX_TABS}`,
					}, 400);
				}
			}
		}

		// Update tabs if provided
		if (tabsUpdateInput.tabs && tabsUpdateInput.tabs.length > 0) {
			// Create a map of updates for efficient lookup
			const updateMap = new Map(tabsUpdateInput.tabs.map(t => [t.id, t]));

			// Apply updates to existing tabs
			config.tabs = config.tabs.map(tab => {
				const update = updateMap.get(tab.id);
				if (!update) return tab;

				return {
					...tab,
					...(update.visible !== undefined && { visible: update.visible }),
					...(update.position !== undefined && { position: update.position }),
					...(update.nameLocalized !== undefined && { nameLocalized: update.nameLocalized }),
				};
			});

			// Sort tabs by position
			config.tabs.sort((a, b) => a.position - b.position);

			// Normalize positions to be 0-based and sequential
			config.tabs.forEach((tab, index) => {
				tab.position = index;
			});
		}

		// Update default tab if provided
		if (tabsUpdateInput.defaultTab) {
			// Validate that the default tab exists and is visible
			const defaultTab = config.tabs.find(t => t.id === tabsUpdateInput.defaultTab);

			if (!defaultTab) {
				return c.json({
					success: false,
					error: `Tab '${tabsUpdateInput.defaultTab}' does not exist`,
				}, 400);
			}

			if (!defaultTab.visible) {
				return c.json({
					success: false,
					error: 'Default tab must be a visible tab',
				}, 400);
			}

			config.defaultTab = tabsUpdateInput.defaultTab;
		}

		// Update metadata
		config.version = (config.version || 1) + 1;
		config.lastModifiedBy = userId;
		config.dateModified = new Date().toISOString();

		// Save updated configuration with explicit error handling (P2 fix)
		try {
			await tabsRepository.putObject(`channel-tabs/${id}`, config);
		} catch (error) {
			logger.error(`[ChannelTabsUpdate] Failed to save tab config for channel ${id}:`, error);
			return c.json({
				success: false,
				error: 'Failed to save tab configuration. Please try again.',
			}, 500);
		}

		// Verify write succeeded with optimistic locking (P1 fix)
		const savedConfig = await tabsRepository.getObject(`channel-tabs/${id}`);
		if (savedConfig && expectedVersion > 0 && savedConfig.version !== config.version) {
			// Conflict detected - another request modified the config
			return c.json({
				success: false,
				error: 'Configuration was modified by another request. Please refresh and try again.',
			}, 409); // 409 Conflict
		}

		// Send queue message for analytics
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.ChannelTabUpdate, {
			channelId: id,
			userId,
			changes: {
				defaultTab: tabsUpdateInput.defaultTab,
				tabUpdates: tabsUpdateInput.tabs?.length || 0,
			},
			timestamp: new Date().toISOString(),
		});

		return {
			success: true,
			result: {
				config,
			},
		};
	}
}
