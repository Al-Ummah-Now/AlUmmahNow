import { Num, Str } from "chanfana";
import { string, z } from "zod";
import { Video as BusinessVideo, PaginationResponse, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { VideoCategory, Channel } from "@al-ummah/shared-types";
import { OptionalAuthRoute, AppContext } from '../../base';
import { logger } from "../../lib/logger";
import { isInternalRecord } from "../../lib/visibility";
import { waitUntilOf } from "../../lib/search/ownership";
import { INDEX_CURSOR_PREFIX, channelVideosFromIndex } from "../../lib/search/channelVideoIndex";
import { edgeCacheUrl, readEdgeCache, writeEdgeCache } from "../../lib/edge-cache";

/** Seconds the anonymous first page of the general feed is reused. */
const LIST_FIRST_PAGE_TTL = 30;

type VideoSort = "date" | "views" | "title" | "likes";
type VideoFilter = "all" | "public" | "private" | "live";

/** Index orders matching /api/videos sorts; title and likes are sorted in memory. */
const INDEX_SORT: Partial<Record<VideoSort, "latest" | "popular">> = { date: "latest", views: "popular" };

/** Index flags matching the /api/videos `filter` parameter. */
const INDEX_FILTER: Record<VideoFilter, { isPublic?: boolean; liveOnly?: boolean }> = {
	all: {},
	public: { isPublic: true },
	private: { isPublic: false },
	live: { liveOnly: true },
};

export class VideosList extends OptionalAuthRoute {
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
				channelId: Str({ description: "Filter by specific channel ID" }).optional().nullable(),
				category: z.nativeEnum(VideoCategory).optional().describe("Filter by video category (e.g., 'quran_recitation', 'islamic_history')"),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
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

	async handle(c: AppContext) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Retrieve the validated parameters
		const { limit, cursor, sort, filter, channelId: queryChannelId, category } = request.query;
		const userId = this.getUserId(c);
		const { channelId } = request.headers;

		// Use channelId from query parameter if provided, otherwise from headers
		const filterChannelId = queryChannelId || channelId;

		// The anonymous first page is the same for every visitor and costs an R2
		// read per video, so it is reused briefly. Pages and channel views are not.
		const firstPageCacheUrl = !userId && !filterChannelId && !cursor
			? edgeCacheUrl(c.req.url, `videos/v1/first-page/${limit}/${sort}/${filter}/${category || "_"}`)
			: null;
		if (firstPageCacheUrl) {
			const cached = await readEdgeCache<PaginationResponse<Record<string, unknown>>>(firstPageCacheUrl);
			if (cached) return cached;
		}

		// Implement your own object list here
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		
		// Filter videos based on privacy settings, user context, and filters
		const isVisible = (video: VideoType) => {
			// Internal records (section indexes, live streams) share the bucket
			if (isInternalRecord(video)) {
				return false;
			}

			// Filter out soft-deleted videos
			if (video.isDeleted) {
				return false;
			}

			// Filter out moderation-hidden videos
			if (video.isHidden) {
				return false;
			}

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
		};

		const compareVideos = (a: VideoType, b: VideoType) => {
			switch (sort) {
				case "views":
					return (b.views || 0) - (a.views || 0);
				case "title":
					return (a.title || "").localeCompare(b.title || "");
				case "likes":
					return (b.likes?.length || 0) - (a.likes?.length || 0);
				default:
					return new Date(b.dateCreated || 0).getTime() - new Date(a.dateCreated || 0).getTime();
			}
		};

		const filteredVideos: VideoType[] = [];
		let nextCursor = cursor;
		let source: "index" | "scan" = "scan";

		// A channel filter is answered from the ownership index (D1): scanning the
		// bucket and filtering afterwards returned empty pages for channels whose
		// videos sat beyond the scanned window, sorted only within that window.
		const indexed = filterChannelId
			? await channelVideosFromIndex<VideoType>(c.env as never, {
				channelId: filterChannelId,
				cursor,
				limit,
				query: {
					sort: INDEX_SORT[sort as VideoSort],
					privateFor: userId || null,
					...INDEX_FILTER[(filter || "all") as VideoFilter],
				},
				load: id => repository.getObject(id),
				isListed: (video): video is VideoType => !!video && Boolean(isVisible(video)),
				compare: INDEX_SORT[sort as VideoSort] ? undefined : compareVideos,
				waitUntil: waitUntilOf(c as never),
			})
			: null;

		if (indexed) {
			source = "index";
			filteredVideos.push(...indexed.videos);
			nextCursor = indexed.cursor;
		} else {
			// R2's native cursor pagination cuts the page before visibility filtering,
			// so a page full of private/internal records used to come back nearly
			// empty (the home page showed 1-3 videos and a "Load More" button). Keep
			// reading whole R2 pages until `limit` visible videos are collected or the
			// bucket is exhausted; the cursor always points after the last page read,
			// so nothing is skipped (a response may hold up to 2*limit-1 videos).
			const MAX_PAGES = 5;
			// An index cursor cannot resume an R2 listing (index became unavailable).
			if (nextCursor?.startsWith(INDEX_CURSOR_PREFIX)) nextCursor = undefined;
			for (let page = 0; page < MAX_PAGES; page++) {
				const batch = await repository.listObjects(limit, nextCursor);
				filteredVideos.push(...(batch.items || []).filter(isVisible));
				nextCursor = batch.cursor || "";
				if (!nextCursor || filteredVideos.length >= limit) break;
			}
			filteredVideos.sort(compareVideos);
		}
		logger.debug('[VideosList] Listed videos', { channelId: filterChannelId, source, count: filteredVideos.length });
		const videos = { cursor: nextCursor };

		// Fetch channel data for all videos
		const channelIds = [...new Set(filteredVideos.map(v => v.channelId).filter(Boolean))];
		const channelMap = new Map<string, Channel>();

		if (channelIds.length > 0) {
			const channelBucket = c.env.channels;
			const channelRepo = new R2Repository<Channel>(channelBucket);

			// Fetch channels in parallel
			const channelPromises = channelIds.map(async (channelId) => {
				try {
					const channel = await channelRepo.getObject(channelId);
					if (channel) {
						channelMap.set(channelId, channel);
					}
				} catch (error) {
					logger.warn('[VideosList] Failed to fetch channel', { channelId, error });
				}
			});

			await Promise.all(channelPromises);
		}

		// Transform business videos to view models
		const transformToView = (video: VideoType) => {
			const channel = video.channelId ? channelMap.get(video.channelId) : undefined;
			return {
				...video,
				channelName: channel?.name || "",
				channelAvatarUrl: channel?.avatarUrl,
				likesCount: video.likes?.length || 0,
				dislikesCount: video.dislikes?.length || 0,
				commentsCount: video.comments?.length || 0,
			};
		};

		// Return response using R2's native cursor
		const response: PaginationResponse<ReturnType<typeof transformToView>> = {
			cursor: videos.cursor || "",
			limit,
			data: filteredVideos.map(transformToView),
		};

		if (firstPageCacheUrl) writeEdgeCache(firstPageCacheUrl, response, LIST_FIRST_PAGE_TTL, waitUntilOf(c as never));

		return response;
	}
}
