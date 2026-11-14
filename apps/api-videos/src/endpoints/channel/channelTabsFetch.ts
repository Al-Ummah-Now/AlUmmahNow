import { Str } from "chanfana";
import { z } from "zod";
import { ChannelTabConfig as BusinessChannelTabConfig, Channel as BusinessChannel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { DEFAULT_CHANNEL_TABS } from '@al-ummah/shared-types';
import { OptionalAuthRoute, AppContext } from "../../base";
import { edgeCacheUrl, readEdgeCache, writeEdgeCache } from '../../lib/edge-cache';
import { waitUntilOf } from '../../lib/search/ownership';

/** Anonymous tab configs (the channel page's server render) are kept per colo this long; signed-in readers always read R2 */
export const CHANNEL_TABS_TTL_SECONDS = 30;

export const channelTabsCacheUrl = (requestUrl: string, channelId: string) => edgeCacheUrl(requestUrl, `channel-tabs/${encodeURIComponent(channelId)}`);

export class ChannelTabsFetch extends OptionalAuthRoute {
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

			const cacheUrl = this.getUserId(c) ? null : channelTabsCacheUrl(c.req.url, id);
			if (cacheUrl) {
				const hit = await readEdgeCache<z.infer<typeof BusinessChannelTabConfig>>(cacheUrl);
				if (hit) return hit;
			}

			// The channel (it must exist) and its tab configuration, read together
			type ChannelType = z.infer<typeof BusinessChannel>;
			type ChannelTabConfigType = z.infer<typeof BusinessChannelTabConfig>;
			const channelRepository = new R2Repository<ChannelType>(c.env.channels);
			const tabsRepository = new R2Repository<ChannelTabConfigType>(c.env.channel_tabs);
			const [channel, stored] = await Promise.all([channelRepository.getObject(id), tabsRepository.getObject(`channel-tabs/${id}`)]);
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

			// Only a channel everyone may see is stored (a private, hidden or deleted one is read from R2 every time)
			const visible = !channel.isPrivate && !channel.isHidden && !channel.isDeleted;
			if (cacheUrl && visible) writeEdgeCache(cacheUrl, config, CHANNEL_TABS_TTL_SECONDS, waitUntilOf(c as never));
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
