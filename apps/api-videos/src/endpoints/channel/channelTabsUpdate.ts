import { Bool, Str } from "chanfana";
import { z } from "zod";
import {
	ChannelTabConfig as BusinessChannelTabConfig,
	ChannelTabConfigUpdateInput,
	Channel as BusinessChannel,
	ResponseError
} from "../../lib/types";
import R2Repository, { rethrowBusy } from "../../lib/r2Repo";
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

		// Apply the update to the fresh configuration with a conditional write
		// (SCALABILITY-AUDIT AV-20): two edits at once (e.g. from two tabs) both
		// land instead of the later one silently reverting the earlier one.
		let config: ChannelTabConfigType | null;
		let rejected: string | undefined;
		try {
			({ data: config, rejected } = await tabsRepository.updateObjectOrReject<string>(`channel-tabs/${id}`, (fresh) => {
				// Update tabs if provided
				if (tabsUpdateInput.tabs && tabsUpdateInput.tabs.length > 0) {
					// Create a map of updates for efficient lookup
					const updateMap = new Map(tabsUpdateInput.tabs.map(t => [t.id, t]));

					// Apply updates to existing tabs
					fresh.tabs = fresh.tabs.map(tab => {
						const update = updateMap.get(tab.id);
						if (!update) return tab;

						return {
							...tab,
							...(update.visible !== undefined && { visible: update.visible }),
							...(update.position !== undefined && { position: update.position }),
							...(update.nameLocalized !== undefined && { nameLocalized: update.nameLocalized }),
						};
					});

					// Sort tabs by position, then normalize positions to be 0-based and sequential
					fresh.tabs.sort((a, b) => a.position - b.position);
					fresh.tabs.forEach((tab, index) => {
						tab.position = index;
					});
				}

				// Update default tab if provided: it must exist and be visible
				if (tabsUpdateInput.defaultTab) {
					const defaultTab = fresh.tabs.find(t => t.id === tabsUpdateInput.defaultTab);
					if (!defaultTab) return { reject: `Tab '${tabsUpdateInput.defaultTab}' does not exist` };
					if (!defaultTab.visible) return { reject: 'Default tab must be a visible tab' };
					fresh.defaultTab = tabsUpdateInput.defaultTab;
				}

				// Update metadata
				fresh.version = (fresh.version || 1) + 1;
				fresh.lastModifiedBy = userId;
				fresh.dateModified = new Date().toISOString();
				return true;
			}, {
				// Default config if the channel has none yet (create-only)
				initial: () => {
					const now = new Date().toISOString();
					return {
						channelId: id,
						defaultTab: 'home',
						tabs: DEFAULT_CHANNEL_TABS.map((tab) => ({ ...tab })),
						version: 1,
						dateCreated: now,
						dateModified: now,
					} as ChannelTabConfigType;
				},
			}));
		} catch (error) {
			rethrowBusy(error);
			logger.error(`[ChannelTabsUpdate] Failed to save tab config for channel ${id}:`, error);
			return c.json({
				success: false,
				error: 'Failed to save tab configuration. Please try again.',
			}, 500);
		}
		if (rejected) {
			return c.json({ success: false, error: rejected }, 400);
		}

		// No queue message: tabs are frontend-only and the processor has no tab handler
		// (every ChannelTabUpdate used to be retried and dead-lettered).

		return {
			success: true,
			result: {
				config,
			},
		};
	}
}
