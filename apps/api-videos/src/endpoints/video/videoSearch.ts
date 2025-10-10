import { Num, OpenAPIRoute, Str } from "chanfana";
import { string, z } from "zod";
import { Video as BusinessVideo, PaginationResponse, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import { getAuthContext } from "../../middleware/auth";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class VideoSearch extends OpenAPIRoute {
	schema = {
		tags: ["Videos"],
		summary: "Search Videos",
		description: "🔓 **Authentication Optional**: Search videos by title, description, or tags. Returns public videos and user's private videos if authenticated.",
		request: {
			query: z.object({
				q: Str({
					description: "Search query - searches in title, description, and tags",
					required: true,
				}),
				limit: Num({
					description: "Limit the number of videos to return",
					default: 9,
				}),
				cursor: string({
					description: "The last cursor returned from the previous request",
				}).optional(),
				sort: z.enum(["relevance", "date", "views", "title"]).optional().default("relevance").describe("Sort order for search results"),
				filter: z.enum(["all", "public", "private"]).optional().default("all").describe("Filter by video privacy"),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns search results for videos",
				content: {
					"application/json": {
						schema: z.object({
							query: z.string(),
							totalResults: z.number(),
							searchTime: z.number(),
							cursor: z.string(),
							limit: z.number(),
							data: z.array(VideoView),
						}),
					},
				},
			},
			"400": {
				description: "Bad request - invalid search query",
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
		const startTime = Date.now();
		
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Get auth context for user information
		const authContext = getAuthContext(c);
		const userId = authContext?.userId;
		const { channelId } = request.headers;

		// Retrieve the validated parameters
		const { q: query, limit, cursor, sort, filter } = request.query;

		// Validate search query
		if (!query || query.trim().length < 2) {
			return c.json({
				success: false,
				error: "Search query must be at least 2 characters long",
			}, 400);
		}

		// Get videos from storage
		const bucket = env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		
		// For now, get all videos and filter in memory
		// In production, this should use a proper search index like Elasticsearch
		let videos = !cursor ? await repository.listObjects(1000) : await repository.listObjects(1000, cursor);
		
		// Normalize search query for matching
		const searchTerms = query.toLowerCase().trim().split(/\s+/);
		
		// Filter and score videos based on search query
		const scoredVideos = (videos.items || [])
			.filter(video => {
				// Apply privacy filter
				if (filter === "public" && video.isPublic === false) return false;
				if (filter === "private" && video.isPublic !== false) return false;
				
				// If video is private, only show if user owns it
				if (video.isPublic === false) {
					return userId && video.userId === userId;
				}
				
				return true;
			})
			.map(video => {
				// Calculate relevance score
				let score = 0;
				const title = (video.title || "").toLowerCase();
				const description = (video.description || "").toLowerCase();
				
				// Score based on exact phrase match (highest weight)
				const queryLower = query.toLowerCase();
				if (title.includes(queryLower)) score += 100;
				if (description.includes(queryLower)) score += 50;
				
				// Score based on individual term matches
				searchTerms.forEach(term => {
					if (title.includes(term)) score += 20;
					if (description.includes(term)) score += 10;
					
					// Boost if term appears at beginning of title
					if (title.startsWith(term)) score += 30;
				});
				
				// Boost popular videos slightly
				score += Math.min(video.views || 0, 100) * 0.1;
				
				return { video, score };
			})
			.filter(item => item.score > 0); // Only include videos with some relevance
		
		// Sort based on sort parameter
		scoredVideos.sort((a, b) => {
			switch (sort) {
				case "relevance":
					return b.score - a.score;
				case "date":
					return new Date(b.video.dateCreated || 0).getTime() - new Date(a.video.dateCreated || 0).getTime();
				case "views":
					return (b.video.views || 0) - (a.video.views || 0);
				case "title":
					return (a.video.title || "").localeCompare(b.video.title || "");
				default:
					return b.score - a.score;
			}
		});
		
		// Apply pagination
		const totalResults = scoredVideos.length;
		const startIndex = cursor ? parseInt(cursor) || 0 : 0;
		const endIndex = Math.min(startIndex + limit, totalResults);
		const paginatedVideos = scoredVideos.slice(startIndex, endIndex);
		
		// Transform to view models
		const transformToView = (video: VideoType) => ({
			...video,
			channelName: "", // TODO: Fetch from channel data
			channelAvatarUrl: undefined,
			likesCount: video.likes?.length || 0,
			dislikesCount: video.dislikes?.length || 0,
			commentsCount: video.comments?.length || 0,
		});

		// Send analytics event for search
		const queue = new Queue();
		await queue.send(MessageType.VideoView, {
			searchQuery: query,
			searchFilter: filter,
			searchSort: sort,
			totalResults,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		const searchTime = Date.now() - startTime;
		const nextCursor = endIndex < totalResults ? endIndex.toString() : "";

		return {
			query,
			totalResults,
			searchTime,
			cursor: nextCursor,
			limit,
			data: paginatedVideos.map(item => transformToView(item.video)),
		};
	}
}