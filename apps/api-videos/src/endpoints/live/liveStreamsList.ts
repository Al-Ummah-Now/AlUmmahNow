import { OptionalAuthRoute, AppContext } from "../../base";
import { Num, Str } from "chanfana";
import { z } from "zod";
import { LiveStream as BusinessLiveStream, PaginationResponse, ResponseError } from "../../lib/types";
import { LiveStreamView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';
import { scanFill } from '../../lib/listFill';

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

			// Filled page of live streams (lib/listFill.ts): filtering a cut listing
			// returned empty pages with a cursor when the first streams were private,
			// hidden or of another status/channel.
			const auth = c.get('auth');
			const isListed = (stream: LiveStreamType | null): stream is LiveStreamType => {
				if (!stream) return false;
				if (status && stream.status !== status) return false;
				if (channelId && stream.channelId !== channelId) return false;
				const isOwner = !!auth && stream.userId === auth.userId;
				// Hidden streams (suspended channel, banned owner, moderation) reach their owner only
				if ((stream as { isHidden?: boolean }).isHidden && !isOwner) return false;
				// Private streams only for their owner
				if (stream.isPrivate && !isOwner) return false;
				return true;
			};
			const scan = await scanFill<LiveStreamType>({
				bucket,
				cursor,
				limit,
				prefix: "livestream:",
				load: async key => {
					try {
						return await repository.getObject(key);
					} catch (error) {
						logger.error(`Error loading stream ${key}:`, error);
						return null;
					}
				},
				isListed,
				label: 'LiveStreamsList',
			});
			const streams = scan.items;

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

			// Sort by date created (newest first) and status (live streams first)
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
					cursor: scan.cursor,
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