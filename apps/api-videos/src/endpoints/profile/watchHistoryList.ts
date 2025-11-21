import { Num, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { getAuthContext } from "../../middleware/auth";
import R2Repository from "../../lib/r2Repo";

// Watch history entry type for response
const WatchHistoryEntry = z.object({
	videoId: z.string(),
	videoTitle: z.string().optional(),
	watchTime: z.number().optional().describe("How long the user watched in seconds"),
	totalDuration: z.number().optional().describe("Total video duration in seconds"),
	watchedAt: z.string().describe("ISO timestamp when video was watched"),
	completed: z.boolean().optional().describe("Whether the video was watched to completion"),
});

export class WatchHistoryList extends OpenAPIRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Get Watch History",
		description: "🔒 **Authentication Required**: Get the user's watch history with pagination.",
		request: {
			headers: z.object({
          userId: z.string().optional().nullable(),
        }),
        query: z.object({
				limit: Num({
					description: "Limit the number of history entries to return",
					default: 20,
				}),
				offset: Num({
					description: "Number of entries to skip for pagination",
					default: 0,
				}),
				filter: z.enum(["all", "completed", "incomplete"]).optional().default("all").describe("Filter by completion status"),
			}),
		},
		responses: {
			"200": {
				description: "Returns user's watch history",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							result: z.object({
								watchHistory: z.array(WatchHistoryEntry),
								totalCount: z.number(),
								hasMore: z.boolean(),
								pagination: z.object({
									limit: z.number(),
									offset: z.number(),
								}),
							}),
						}),
					},
				},
			},
			"401": {
				description: "Unauthorized - missing or invalid authentication token",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"404": {
				description: "User profile not found",
				content: {
					"application/json": {
						schema: ResponseError,
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

	async handle(c) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Get auth context for user information
		const authContext = getAuthContext(c);
		const userId = authContext?.userId;

		if (!userId) {
			return c.json({
				success: false,
				error: "Authentication required"
			}, 401);
		}

		const { limit, offset, filter } = request.query;

		// Get user profile from storage
		const bucket = c.env.profiles;
		type ProfileType = z.infer<typeof BusinessProfile>;
		const repository = new R2Repository<ProfileType>(bucket);
		const profile = await repository.getObject(userId);

		if (!profile) {
			return c.json({
				success: false,
				error: "User profile not found"
			}, 404);
		}

		// Get watch history (initialize empty if doesn't exist)
		let watchHistory = profile.watchHistory || [];

		// Apply filter
		if (filter === "completed") {
			watchHistory = watchHistory.filter((entry: any) => entry.completed === true);
		} else if (filter === "incomplete") {
			watchHistory = watchHistory.filter((entry: any) => entry.completed !== true);
		}

		// Calculate pagination
		const totalCount = watchHistory.length;
		const hasMore = offset + limit < totalCount;
		const paginatedHistory = watchHistory.slice(offset, offset + limit);

		return {
			success: true,
			result: {
				watchHistory: paginatedHistory,
				totalCount,
				hasMore,
				pagination: {
					limit,
					offset,
				},
			},
		};
	}
}