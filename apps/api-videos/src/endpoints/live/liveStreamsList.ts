import { OpenAPIRoute, Num } from "chanfana";
import { z } from "zod";
import { LiveStream as BusinessLiveStream, PaginationResponse, ResponseError } from "../../lib/types";
import { LiveStreamView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { logger } from '../../lib/logger';

export class LiveStreamsList extends OpenAPIRoute {
	schema = {
		tags: ["Live Streams"],
		summary: "List Live Streams",
		description: "Get a paginated list of live streams. Public endpoint that returns both scheduled and active streams.",
		request: {
			headers: z.object({
          channelId: z.string().optional().nullable(),
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

	async handle(c) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { cursor = "", limit = 9, status, channelId } = request.query;

		try {
			const bucket = c.env.videos;
			type LiveStreamType = z.infer<typeof BusinessLiveStream>;
			const repository = new R2Repository<LiveStreamType>(bucket);

			// List live streams with livestream: prefix
			// Since R2Repository doesn't support prefix directly, we'll need to use the R2 bucket directly for listing
			const listResult = await bucket.list({
				prefix: "livestream:",
				cursor,
				limit,
			});

			let streams: LiveStreamType[] = [];

			// Fetch the actual stream data
			if (listResult.objects) {
				for (const obj of listResult.objects) {
					if (obj.key && obj.key.startsWith('livestream:')) {
						try {
							const stream = await repository.getObject(obj.key);
							if (stream) {
								streams.push(stream);
							}
						} catch (error) {
							logger.error(`Error loading stream ${obj.key}:`, error);
							// Continue with other streams
						}
					}
				}
			}

			// Apply filters
			if (status) {
				streams = streams.filter(stream => stream.status === status);
			}
			if (channelId) {
				streams = streams.filter(stream => stream.channelId === channelId);
			}

			// Filter out private streams for non-authenticated users
			const auth = c.get('auth');
			if (!auth) {
				streams = streams.filter(stream => !stream.isPrivate);
			} else {
				// Show private streams only if user owns the channel
				streams = streams.filter(stream => 
					!stream.isPrivate || stream.userId === auth.userId
				);
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
					cursor: listResult.truncated ? listResult.cursor || "" : "",
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