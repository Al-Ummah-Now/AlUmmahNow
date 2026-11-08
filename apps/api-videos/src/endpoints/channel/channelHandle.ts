/**
 * Channel @handle and About endpoints (Story 29.1)
 *
 * - GET  /api/channels/handles/:handle/availability   availability for the active channel
 * - GET  /api/channels/by-handle/:handle              channel by @handle (case-insensitive)
 * - GET  /api/channels/:id/about                      About tab data with totals
 * - POST /internal/channels/backfill-handles          (X-API-Key) default handles for old channels
 */

import { Bool, Num, Str } from "chanfana";
import { z } from "zod";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { PublicChannelView } from "../../lib/model/view";
import { toPublicChannel } from "../../lib/public-views";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, PublicRoute, AppContext } from "../../base";
import { logger } from "../../lib/logger";
import {
	canClaimOfficialHandles,
	checkHandleAvailability,
	handleKey,
	claimDefaultHandle,
	defaultHandleCandidates,
	normalizeHandleInput,
	readHandleEntry,
	resolveHandle,
} from "../../lib/channelHandles";
import { buildChannelAbout, computeChannelTotals, isChannelVisibleTo } from "../../lib/channelAbout";
import { channelTotalsFromIndex, scheduleOwnershipHeal, waitUntilOf } from "../../lib/search/ownership";

type ChannelType = z.infer<typeof BusinessChannel>;

const HandleProblemEnum = z.enum(['too_short', 'too_long', 'invalid_characters', 'reserved', 'taken']);

export class ChannelHandleAvailability extends OptionalAuthRoute {
	schema = {
		tags: ["Channels"],
		summary: "Check whether a channel @handle can be claimed",
		description: "Handles are 3-30 characters (Latin letters, digits, `.`, `_`, `-`; starting and ending with a letter or digit), unique case-insensitively, and not a reserved word. Pass `channelId` (query) so the channel's own current handle counts as available.",
		request: {
			params: z.object({ handle: Str({ description: "Handle, with or without a leading @" }) }),
			query: z.object({ channelId: Str({ required: false, description: "Channel that wants the handle" }) }),
		},
		responses: {
			"200": {
				description: "Availability",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({ handle: Str(), available: Bool(), reason: HandleProblemEnum.optional() }),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const allowOfficial = canClaimOfficialHandles(this.getAuth(c)?.payload?.roles);
		const result = await checkHandleAvailability(c.env.channel_tabs, request.params.handle, request.query.channelId || undefined, { allowOfficial });
		return { success: true, result };
	}
}

async function loadVisibleChannel(c: AppContext, id: string, userId?: string): Promise<ChannelType | null> {
	const channel = await new R2Repository<ChannelType>(c.env.channels).getObject(id);
	return isChannelVisibleTo(channel, userId) ? channel : null;
}

export class ChannelByHandleFetch extends OptionalAuthRoute {
	schema = {
		tags: ["Channels"],
		summary: "Get a channel by its @handle",
		request: {
			params: z.object({ handle: Str({ description: "Handle, with or without a leading @ (case-insensitive)" }) }),
		},
		responses: {
			"200": { description: "The channel", content: { "application/json": { schema: PublicChannelView } } },
			"404": { description: "No channel has this handle", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const handle = normalizeHandleInput(request.params.handle);
		const userId = this.getUserId(c);

		const channelId = await resolveHandle(c.env.channel_tabs, handle);
		const channel = channelId ? await loadVisibleChannel(c, channelId, userId) : null;
		// The index entry must still match the channel (it may have changed handle meanwhile)
		if (!channel || (channel.handle || '').toLowerCase() !== handle.toLowerCase()) {
			logger.debug('[ChannelByHandle] Not found', { handle, channelId });
			return c.json({ success: false, error: "Object not found" }, 404);
		}
		return toPublicChannel(channel);
	}
}

export class ChannelAbout extends OptionalAuthRoute {
	schema = {
		tags: ["Channels"],
		summary: "Channel About tab data",
		description: "Description (with localized variants), links (http/https only), optional contact email, location, joined date and totals (views and videos over public published videos, subscribers). `statsPartial` is true when the totals scan hit its bound.",
		request: {
			params: z.object({ id: Str({ description: "Channel id" }) }),
		},
		responses: {
			"200": {
				description: "About data",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								channelId: Str(),
								handle: Str().nullable(),
								description: Str(),
								descriptionLocalized: z.record(z.string()),
								links: z.array(z.object({ title: Str(), url: Str() })),
								contactEmail: Str().nullable(),
								location: Str().nullable(),
								joinedDate: Str(),
								totalViews: Num(),
								videosCount: Num(),
								subscribersCount: Num(),
								statsPartial: Bool(),
							}),
						}),
					},
				},
			},
			"404": { description: "Channel not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id } = request.params;
		const channel = await loadVisibleChannel(c, id, this.getUserId(c));
		if (!channel) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}
		// Ownership index: one aggregate query. Until the index is complete,
		// scan the videos bucket as before and rebuild the index in the background.
		let totals = await channelTotalsFromIndex(c.env as never, id);
		const source = totals ? "index" : "scan";
		if (!totals) {
			totals = await computeChannelTotals(c.env.videos, id);
			scheduleOwnershipHeal(c.env as never, waitUntilOf(c as never), "video");
		}
		logger.debug('[ChannelAbout] Totals', { channelId: id, source, ...totals });
		return { success: true, result: buildChannelAbout(channel, totals) };
	}
}

/**
 * Assign default handles to channels created before handles existed.
 * Idempotent; page through with `cursor` until `nextCursor` is null.
 */
export class ChannelHandlesBackfill extends PublicRoute {
	schema = {
		tags: ["Internal"],
		summary: "Backfill default @handles (X-API-Key)",
		request: {
			query: z.object({
				limit: Num({ description: "Channels per call (max 200)", default: 100 }).optional(),
				cursor: Str({ required: false, description: "nextCursor from the previous call" }),
				dryRun: z.enum(['true', 'false']).optional().describe("Report without writing"),
			}),
		},
		responses: {
			"200": {
				description: "Backfill page result",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								scanned: Num(),
								assigned: z.array(z.object({ channelId: Str(), handle: Str() })),
								repaired: Num(),
								skipped: Num(),
								failed: z.array(Str()),
								nextCursor: Str().nullable(),
								dryRun: Bool(),
							}),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const limit = Math.min(Math.max(1, Number(request.query.limit) || 100), 200);
		const dryRun = request.query.dryRun === 'true';
		const repo = new R2Repository<ChannelType>(c.env.channels);
		const page = await c.env.channels.list({ limit, cursor: request.query.cursor || undefined });

		const assigned: Array<{ channelId: string; handle: string }> = [];
		const failed: string[] = [];
		let skipped = 0;
		let repaired = 0;

		for (const object of page.objects) {
			const channel = await repo.getObject(object.key);
			if (!channel?.id || channel.isDeleted) {
				skipped++;
				continue;
			}
			if (channel.handle) {
				// Make sure the index points at this channel (repairs a lost index write)
				const entry = await readHandleEntry(c.env.channel_tabs, channel.handle);
				if (!entry && !dryRun) {
					const restored = await checkHandleAvailability(c.env.channel_tabs, channel.handle, channel.id);
					if (restored.available) {
						await c.env.channel_tabs.put(handleKey(channel.handle), JSON.stringify({
							handle: channel.handle, channelId: channel.id, userId: channel.userId, dateClaimed: new Date().toISOString(),
						}), { httpMetadata: { contentType: 'application/json' } });
						repaired++;
					}
				}
				skipped++;
				continue;
			}
			if (dryRun) {
				// Report the handle the real run would most likely claim (read-only)
				let preview = '';
				for (const candidate of defaultHandleCandidates(channel)) {
					if ((await checkHandleAvailability(c.env.channel_tabs, candidate, channel.id)).available) {
						preview = candidate;
						break;
					}
				}
				assigned.push({ channelId: channel.id, handle: preview });
				continue;
			}
			try {
				const handle = await claimDefaultHandle(c.env.channel_tabs, channel);
				if (!handle) {
					failed.push(channel.id);
					continue;
				}
				await repo.putObject(object.key, { ...channel, handle });
				assigned.push({ channelId: channel.id, handle });
			} catch (error) {
				logger.error('[HandlesBackfill] Failed', { channelId: channel.id, error: error instanceof Error ? error.message : String(error) });
				failed.push(channel.id);
			}
		}

		const nextCursor = page.truncated ? page.cursor : null;
		logger.info('[HandlesBackfill] Page done', { scanned: page.objects.length, assigned: assigned.length, repaired, skipped, failed: failed.length, nextCursor, dryRun });
		return { success: true, result: { scanned: page.objects.length, assigned, repaired, skipped, failed, nextCursor, dryRun } };
	}
}
