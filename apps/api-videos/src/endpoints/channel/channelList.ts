import { ownerSeesSuspendedChannel } from "../../lib/visibility";
import { Num, Str } from "chanfana";
import { FALLBACK_SCAN_OBJECTS } from "../../lib/scanBudget";
import { string, z } from "zod";
import { Channel as BusinessChannel, PaginationResponse, ResponseError } from "../../lib/types";
import { PublicChannelView } from "../../lib/model/view";
import { toPublicChannels } from "../../lib/public-views";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { OptionalAuthRoute, AppContext } from "../../base";
import { logger } from "../../lib/logger";
import { ownedChannelIds, scheduleOwnershipHeal, waitUntilOf } from "../../lib/search/ownership";

export class ChannelsList extends OptionalAuthRoute {
	schema = {
		tags: ["Channels"],
		summary: "List Channels",
		request: {
			query: z.object({
				limit: Num({
					description: "Limit the number of Channels to return",
					default: 10,
				}),
				cursor: string({
					description: "The last cursor returned from the previous request",
				}).optional(),
				scope: z.enum(["mine", "all"]).optional().describe(
					"'mine' (default) returns only the authenticated user's channels when signed in; 'all' returns every publicly visible channel (channel directory)",
				),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a list of Channels",
				content: {
					"application/json": {
						schema: PaginationResponse.extend({ data: z.array(PublicChannelView) }),
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

		// Retrieve the validated parameters
		const { limit, cursor, scope } = request.query;
		const userId = this.getUserId(c);
		const { channelId } = request.headers;

		// Implement your own object list here
		const bucket = c.env.channels;
		type ChannelType = z.infer<typeof BusinessChannel>;
		const repository = new R2Repository<ChannelType>(bucket);
		const mineOnly = Boolean(userId) && scope !== "all";
		let Channels: { cursor: string; items: ChannelType[] };

		if (mineOnly) {
			// "My channels": read the user's channel ids from the ownership index
			// (O(user's channels)); objects are still loaded from R2 and filtered
			// below exactly as before. Like the scan, the whole set is returned
			// regardless of `limit`, in R2 key order, with an empty cursor.
			const ids = await ownedChannelIds(c.env as never, userId);
			if (ids) {
				const items = await Promise.all(ids.map(id => repository.getObject(id)));
				Channels = { cursor: "", items: items.filter((ch): ch is ChannelType => ch !== null) };
				logger.debug('[ChannelsList] Served "mine" from ownership index', { userId, channels: ids.length });
			} else {
				Channels = await scanAllChannels(repository, limit, cursor);
				scheduleOwnershipHeal(c.env as never, waitUntilOf(c as never), 'channel');
			}
		} else {
			Channels = !cursor ? await repository.listObjects(limit) : await repository.listObjects(limit, cursor);
		}

		// Filter channels by userId if provided, and apply privacy/moderation filters
		let filteredChannels = (Channels.items || []).filter(channel => {
			// Filter out soft-deleted channels
			if (channel.isDeleted) {
				return false;
			}

			// Filter out moderation-hidden channels (an owner still lists a channel an admin suspended)
			if (channel.isHidden && !(mineOnly && ownerSeesSuspendedChannel(channel as never, userId))) {
				return false;
			}

			// Filter out private channels (except for owner)
			if (channel.isPrivate && (scope === "all" || channel.userId !== userId)) {
				return false;
			}

			return true;
		});

		// Additional filter by userId if requested (to show only user's channels)
		if (userId && scope !== "all") {
			filteredChannels = filteredChannels.filter(channel => channel.userId === userId);
		}

		// Transform business channels to view models
		const channelViews = await toPublicChannels(c.env.NOTIFICATIONS_DB, filteredChannels, c.env as never);

		let response: PaginationResponse<any>;
		if (!filteredChannels || filteredChannels.length === 0) {
			response = {
				// In directory mode a page may contain only hidden/private channels;
				// keep the cursor so clients can continue to the next page.
				cursor: scope === "all" ? Channels.cursor : "",
				limit,
				data: [],
			};
		} else {
			response = {
				cursor: Channels.cursor,
				limit,
				data: channelViews,
			};
		}

		return response;
	}
}

/**
 * Fallback for "my channels" while the ownership index is incomplete: keep
 * paging (bounded) so the result does not depend on where the owner's
 * channels fall in the global listing order.
 */
async function scanAllChannels<T>(repository: R2Repository<T>, limit: number, cursor?: string): Promise<{ cursor: string; items: T[] }> {
	// Bounded (SCALABILITY-AUDIT AV-16)
	const MAX_PAGES = Math.max(1, Math.ceil(FALLBACK_SCAN_OBJECTS / Math.max(1, limit)));
	const first = !cursor ? await repository.listObjects(limit) : await repository.listObjects(limit, cursor);
	const collected = [...(first.items || [])];
	let next = first.cursor;
	let pages = 1;
	while (next && pages < MAX_PAGES) {
		const page = await repository.listObjects(100, next);
		collected.push(...(page.items || []));
		next = page.cursor;
		pages++;
	}
	return { cursor: "", items: collected };
}
