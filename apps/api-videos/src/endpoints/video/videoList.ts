import { Num, OpenAPIRoute, Str } from "chanfana";
import { string, z } from "zod";
import { Video as BusinessVideo, PaginationResponse, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { VideoCategory } from "@al-ummah/shared-types";

export class VideosList extends OpenAPIRoute {
	schema = {
		tags: ["Videos"],
		summary: "List Videos",
		description: "🔓 **Authentication Optional**: This endpoint works without authentication but returns additional private videos when authenticated with a valid JWT token in the Authorization header (Bearer <token>).",
		request: {
			query: z.object({
				limit: Num({
					description: "Limit the number of videos to return",
					default: 9,
				}),
				cursor: string({
					description: "The last cursor returned from the previous request",

				}).optional(),
				sort: z.enum(["date", "views", "title", "likes"]).optional().default("date").describe("Sort order for videos"),
				filter: z.enum(["all", "public", "private", "live"]).optional().default("all").describe("Filter videos by type"),
				channelId: Str({ description: "Filter by specific channel ID" }).optional(),
				category: z.nativeEnum(VideoCategory).optional().describe("Filter by video category (e.g., 'quran_recitation', 'islamic_history')"),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
				userId: Str({ description: "User ID (automatically set from JWT token if authenticated)" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a list of videos",
				content: {
					"application/json": {
						schema: PaginationResponse.extend({ data: z.array(VideoView) }),
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

		// Retrieve the validated parameters
		const { limit, cursor, sort, filter, channelId: queryChannelId, category } = request.query;
		const { channelId, userId } = request.headers;

		// Use channelId from query parameter if provided, otherwise from headers
		const filterChannelId = queryChannelId || channelId;

		// Implement your own object list here
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		
		// Use R2's native cursor pagination
		const videos = await repository.listObjects(limit, cursor);
		
		// Filter videos based on privacy settings, user context, and filters
		let filteredVideos = (videos.items || []).filter(video => {
			// Apply channel filter if specified
			if (filterChannelId && video.channelId !== filterChannelId) {
				return false;
			}

			// Apply category filter if specified
			if (category && video.category !== category) {
				return false;
			}

			// Apply type filter
			if (filter === "public" && video.isPublic === false) return false;
			if (filter === "private" && video.isPublic !== false) return false;
			if (filter === "live" && !video.isLive) return false;

			// If video is explicitly private (false), only show if user owns it
			if (video.isPublic === false) {
				return userId && video.userId === userId;
			}

			// If video is public (true) or undefined/null (default to public), always show it
			return true;
		});
		
		// Sort videos based on sort parameter
		filteredVideos.sort((a, b) => {
			switch (sort) {
				case "date":
					return new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
				case "views":
					return (b.views || 0) - (a.views || 0);
				case "title":
					return (a.title || "").localeCompare(b.title || "");
				case "likes":
					const aLikes = a.likes?.length || 0;
					const bLikes = b.likes?.length || 0;
					return bLikes - aLikes;
				default:
					return new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
			}
		});
		
		// Transform business videos to view models
		const transformToView = (video: VideoType) => ({
			...video,
			channelName: "", // TODO: Fetch from channel data
			channelAvatarUrl: undefined,
			likesCount: video.likes?.length || 0,
			dislikesCount: video.dislikes?.length || 0,
			commentsCount: video.comments?.length || 0,
		});

		// Return response using R2's native cursor
		const response: PaginationResponse<ReturnType<typeof transformToView>> = {
			cursor: videos.cursor || "",
			limit,
			data: filteredVideos.map(transformToView),
		};

		return response;
	}
}
