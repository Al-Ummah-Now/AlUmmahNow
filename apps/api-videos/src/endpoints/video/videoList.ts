import { can, isShort } from "@al-ummah/shared-types";
import { Num, Str } from "chanfana";
import { publicVideoFields, uploaderProcessingIssue } from '../../lib/transformations';
import { string, z } from "zod";
import { Video as BusinessVideo, PaginationResponse, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { VideoCategory, Channel } from "@al-ummah/shared-types";
import { OptionalAuthRoute, AppContext } from '../../base';
import { logger } from "../../lib/logger";
import { isInternalRecord, isVideoListedFor } from "../../lib/visibility";
import { waitUntilOf } from "../../lib/search/ownership";
import { channelVideosFromIndex } from "../../lib/search/channelVideoIndex";
import { scanFill } from "../../lib/listFill";
import { edgeCacheUrl, readEdgeCache, writeEdgeCache } from "../../lib/edge-cache";
import { FIRST_PAGE_TTL_SECONDS, videoListGeneration } from "../../lib/videoListCache";
import { PUBLIC_DISLIKES_COUNT } from "../../lib/reactions";

/** Seconds the anonymous first page of the general feed is reused. */

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

/** The search text as compared: trimmed, NFKC, lower case; null when empty. */
export function normalizeTitleQuery(q: string | null | undefined): string | null {
	const text = (q ?? "").normalize("NFKC").trim().toLocaleLowerCase();
	return text ? text : null;
}

/** Whether the video's title (or one of its translations) contains `query` (normalizeTitleQuery). */
export function titleMatches(video: { title?: string | null; titleLocalized?: unknown }, query: string): boolean {
	const titles = [video.title, ...Object.values((video.titleLocalized && typeof video.titleLocalized === "object" ? video.titleLocalized : {}) as Record<string, unknown>)];
	return titles.some((title) => typeof title === "string" && title.normalize("NFKC").toLocaleLowerCase().includes(query));
}

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
				format: z.enum(["video", "short"]).optional().describe("Only Shorts (`short`) or everything but Shorts (`video`)"),
				q: Str({ description: "Only videos whose title contains this text (any language, case-insensitive). A page can come back short with a cursor: keep following it." }).max(200).optional(),
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
		const { limit, cursor, sort, filter, channelId: queryChannelId, category, format, q } = request.query;
		const titleQuery = normalizeTitleQuery(q);
		const userId = this.getUserId(c);
		const { channelId } = request.headers;

		// Use channelId from query parameter if provided, otherwise from headers
		const filterChannelId = queryChannelId || channelId;

		// The anonymous first page is the same for every visitor and costs an R2
		// read per video, so it is reused briefly. Pages and channel views are not.
		// Keyed by the list's generation: a delete, edit or hide drops every cached variant (lib/videoListCache.ts)
		const firstPageCacheUrl = !userId && !filterChannelId && !cursor && !format && !titleQuery
			? edgeCacheUrl(c.req.url, `videos/v1/first-page/${await videoListGeneration(c.req.url)}/${limit}/${sort}/${filter}/${category || "_"}`)
			: null;
		if (firstPageCacheUrl) {
			const cached = await readEdgeCache<PaginationResponse<Record<string, unknown>>>(firstPageCacheUrl);
			if (cached) return cached;
		}

		// Implement your own object list here
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);
		
		// Whose private videos this caller sees: their own, or, while acting as the
		// filtered channel with a role allowing it (channelIdMiddleware resolved
		// it from the channel record), that channel owner's
		const actingRole = c.get('channelRole');
		const privateOwnerId: string | null = filterChannelId && channelId === filterChannelId && actingRole && actingRole !== 'owner' && can(actingRole, 'video.view_private')
			? (c.get('channelOwnerId') ?? null)
			: (userId || null);

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

			// Format and title filters (the playlist picker)
			if (format === "short" && !isShort(video)) return false;
			if (format === "video" && isShort(video)) return false;
			if (titleQuery && !titleMatches(video, titleQuery)) return false;

			// Apply type filter
			if (filter === "public" && video.isPublic === false) return false;
			if (filter === "private" && video.isPublic !== false) return false;
			if (filter === "live" && !video.isLive) return false;

			// One listing rule (lib/visibility.ts): public + ready for everyone;
			// the owner (or a channel member acting with video.view_private, as
			// that owner) also sees their private and processing videos
			return isVideoListedFor(video, privateOwnerId);
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

		// Answered from the ownership index (D1), with or without a channel filter.
		// The bucket scan reads keys (random UUIDs) in order and sorts only the page
		// it found: a channel's videos beyond the scanned window came back as empty
		// pages, and the unfiltered list (home grid, "All videos") showed whichever
		// keys came first instead of the newest videos (#1029). The index has no
		// category or title column, so those filters keep the scan.
		const indexed = filterChannelId || (!category && !titleQuery)
			? await channelVideosFromIndex<VideoType>(c.env as never, {
				channelId: filterChannelId || null,
				cursor,
				limit,
				query: {
					sort: INDEX_SORT[sort as VideoSort],
					privateFor: privateOwnerId,
					...INDEX_FILTER[(filter || "all") as VideoFilter],
					...(format === "short" ? { shortsOnly: true } : format === "video" ? { notShort: true } : {}),
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
			// Bucket scan: keep reading until `limit` visible videos are found or the
			// bucket is exhausted (lib/listFill.ts). Filtering after cutting an R2
			// page returned `data: []` with a cursor whenever the first keys were
			// private, processing or internal records (stage, limit=1, 2026-11-11).
			const page = await scanFill<VideoType>({
				bucket,
				cursor: nextCursor,
				limit,
				load: key => repository.getObject(key),
				isListed: (video): video is VideoType => !!video && Boolean(isVisible(video)),
				label: 'VideosList',
			});
			filteredVideos.push(...page.items);
			nextCursor = page.cursor;
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
				...publicVideoFields(video),
				...uploaderProcessingIssue(video, channel, userId),
				channelName: channel?.name || "",
				channelAvatarUrl: channel?.avatarUrl,
				likesCount: video.likes?.length || 0,
				dislikesCount: PUBLIC_DISLIKES_COUNT,
				isShort: isShort(video),
				commentsCount: video.comments?.length || 0,
			};
		};

		// Return response using R2's native cursor
		const response: PaginationResponse<ReturnType<typeof transformToView>> = {
			cursor: videos.cursor || "",
			limit,
			data: filteredVideos.map(transformToView),
		};

		if (firstPageCacheUrl) writeEdgeCache(firstPageCacheUrl, response, FIRST_PAGE_TTL_SECONDS, waitUntilOf(c as never));

		return response;
	}
}
