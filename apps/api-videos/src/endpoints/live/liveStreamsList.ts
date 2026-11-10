import { OptionalAuthRoute, AppContext } from "../../base";
import { Num, Str } from "chanfana";
import { z } from "zod";
import { LiveStream as BusinessLiveStream, PaginationResponse, ResponseError } from "../../lib/types";
import { LiveStreamView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { scheduleOwnershipHeal, streamListIds, waitUntilOf } from '../../lib/search/ownership';
import { pageFromIndex } from '../../lib/search/indexPage';
import { scanPage } from '../../lib/scanCursor';

export class LiveStreamsList extends OptionalAuthRoute {
	schema = {
		tags: ["Live Streams"],
		summary: "List Live Streams",
		description: "Get a paginated list of live streams. Public endpoint that returns both scheduled and active streams.",
		request: {
			headers: z.object({
				channelId: Str({ description: "User's selected channel ID" }).optional().nullable(),
			}),
			query: z.object({
				cursor: z.string().optional().openapi({ example: "" }),
				limit: Num({ default: 9 }).openapi({ example: 9 }),
				status: z.enum(['scheduled', 'live', 'ended', 'cancelled']).optional().describe("Filter by stream status"),
				channelId: z.string().optional().describe("Filter by channel ID"),
			}),
		},
		responses: {
			"200": {
				description: "Returns paginated list of live streams",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean().default(true),
							result: PaginationResponse.extend({
								data: z.array(LiveStreamView),
							}),
						}),
					},
				},
			},
			"400": {
				description: "Bad request - invalid query parameters",
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
		const request = await this.getValidatedData<typeof this.schema>();
		const { cursor = "", limit = 9, status, channelId } = request.query;

		try {
			const bucket = c.env.videos;
			type LiveStreamType = z.infer<typeof BusinessLiveStream>;
			const repository = new R2Repository<LiveStreamType>(bucket);

			const auth = c.get('auth');
			const viewerId = auth?.userId ?? null;
			// Hidden streams (suspended channel, banned owner, moderation) and private
			// ones reach their owner only
			const isListed = (stream: LiveStreamType | null): stream is LiveStreamType =>
				!!stream &&
				(!status || stream.status === status) &&
				(!channelId || stream.channelId === channelId) &&
				(!(stream as { isHidden?: boolean }).isHidden || (!!viewerId && stream.userId === viewerId)) &&
				(!stream.isPrivate || (!!viewerId && stream.userId === viewerId));

			// Live first, then newest: one keyset page of the ownership index (kind
			// 'stream'). Filtering a prefix listing returned short or empty pages.
			const indexed = await pageFromIndex<LiveStreamType>({
				cursor,
				sort: 'live-first',
				limit,
				fetch: (after, pageLimit) => streamListIds(c.env as never, { channelId: channelId || null, status, limit: pageLimit, after, viewerId }),
				load: (id) => repository.getObject(`livestream:${id}`),
				isListed,
			});

			let streams: LiveStreamType[];
			let nextCursor: string;
			if (indexed) {
				streams = indexed.items;
				nextCursor = indexed.cursor;
			} else {
				// Index unavailable: a bounded scan of the livestream: prefix that keeps its place (lib/scanCursor.ts)
				if (!cursor) scheduleOwnershipHeal(c.env as never, waitUntilOf(c as never), 'stream');
				const scanned = await scanPage<LiveStreamType>({
					cursor,
					limit,
					list: async (pageCursor, pageSize) => {
						const batch = await repository.listObjects(pageSize, pageCursor, 'livestream:');
						return { items: batch.items || [], cursor: batch.cursor || '' };
					},
					isListed,
				});
				streams = scanned.items;
				nextCursor = scanned.cursor;
			}

			// Transform to view models
			const streamViews = streams.map(stream => ({
				...stream,
				likesCount: stream.likes?.length || 0,
				dislikesCount: stream.dislikes?.length || 0,
				commentsCount: stream.comments?.length || 0,
				// Calculate duration if stream has ended
				duration: stream.actualEndTime && stream.actualStartTime 
					? Math.floor((new Date(stream.actualEndTime).getTime() - new Date(stream.actualStartTime).getTime()) / 1000)
					: undefined,
				// Remove sensitive data for public view
				streamKey: undefined,
				rtmpUrl: auth?.userId === stream.userId ? stream.rtmpUrl : undefined,
			}));

			// Live streams first, then newest (the index order; the scan page is sorted the same way)
			streamViews.sort((a, b) => {
				// Live streams first
				if (a.status === 'live' && b.status !== 'live') return -1;
				if (b.status === 'live' && a.status !== 'live') return 1;
				// Then by date created (newest first)
				return new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime();
			});

			return {
				success: true,
				result: {
					cursor: nextCursor,
					limit,
					data: streamViews,
				},
			};
		} catch (error) {
			logger.error("Error listing live streams:", error);
			return c.json(
				{
					success: false,
					error: "Failed to fetch live streams",
				},
				500
			);
		}
	}
}