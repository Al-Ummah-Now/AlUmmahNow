import { Num, OpenAPIRoute, Str } from "chanfana";
import { OptionalAuthRoute, AppContext } from '../../base';
import { string, z } from "zod";
import { Video as BusinessVideo, Channel as BusinessChannel, PaginationResponse, ResponseError } from "../../lib/types";
import { VideoView } from "../../lib/model/view";
import R2Repository from "../../lib/r2Repo";
import { Channel } from "@al-ummah/shared-types";
import { logger } from "../../lib/logger";
import { isVideoRemoved } from "../../lib/visibility";
import { channelsVideoIds, ownerContentIds, scheduleOwnershipHeal, waitUntilOf } from "../../lib/search/ownership";
import { publicSearchCandidateIds } from "../../lib/feedIndex";
import { FALLBACK_SCAN_OBJECTS } from "../../lib/scanBudget";

/** Videos loaded for a channel or owner search (one R2 get each, below the subrequest limit). */
const INDEXED_CANDIDATES = 500;

export class VideoSearch extends OptionalAuthRoute {
	schema = {
		tags: ["Videos"],
		summary: "Search Videos",
		description: "🔓 **Authentication Optional**: Search videos by title, description, or tags. Returns public videos and user's private videos if authenticated. When isOwner is true, validates ownership of requested channels.",
		request: {
			query: z.object({
				q: Str({
					description: "Search query - searches in title, description, and tags",
					required: false,
				}).optional(),
				limit: Num({
					description: "Limit the number of videos to return",
					default: 9,
				}),
				cursor: string({
					description: "The last cursor returned from the previous request",
				}).optional(),
				sort: z.enum(["relevance", "date", "views", "title"]).optional().default("relevance").describe("Sort order for search results"),
				filter: z.enum(["all", "public", "private"]).optional().default("all").describe("Filter by video privacy"),
				channelIds: Str({
					description: "Comma-separated channel IDs to filter by",
				}).optional(),
				durationFilter: z.enum(["all", "short", "standard", "live"]).optional().default("all").describe("Filter videos by duration - short (≤3min), standard (>3min), live, or all"),
				scheduleFilter: z.enum(["all", "scheduled", "published"]).optional().default("all").describe("Filter by scheduled publish status - scheduled/publishing, published, or all"),
				isOwner: z.boolean().optional().default(false).describe("When true, validates that the user owns all specified channels"),
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
							query: z.string().optional(),
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
			"403": {
				description: "Forbidden - user doesn't own all requested channels",
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
		const startTime = Date.now();

		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Get auth context for user information
		const userId = this.getUserId(c);

		// Retrieve the validated parameters
		const {
			q: query,
			limit,
			cursor,
			sort,
			filter,
			channelIds,
			durationFilter,
			scheduleFilter,
			isOwner
		} = request.query;

		// Parse channel IDs if provided
		const channelIdList = channelIds ? channelIds.split(',').map(id => id.trim()).filter(Boolean) : [];

		// Ownership validation when isOwner is true
		if (isOwner) {
			// Ensure userId is present
			if (!userId) {
				return c.json({
					success: false,
					error: "User authentication required when isOwner is true",
				}, 403);
			}

			// If channelIds are specified, validate ownership
			if (channelIdList.length > 0) {
				const channelBucket = c.env.channels;
				type ChannelType = z.infer<typeof BusinessChannel>;
				const channelRepo = new R2Repository<ChannelType>(channelBucket);

				// Check ownership for each channel
				for (const channelId of channelIdList) {
					const channel = await channelRepo.getObject(channelId);
					if (!channel || channel.userId !== userId) {
						return c.json({
							success: false,
							error: `User does not own channel ${channelId}`,
						}, 403);
					}
				}
			}
		}

		// Validate search query if provided
		if (query && query.trim().length < 2) {
			return c.json({
				success: false,
				error: "Search query must be at least 2 characters long",
			}, 400);
		}

		// Get videos from storage
		const bucket = c.env.videos;
		type VideoType = z.infer<typeof BusinessVideo>;
		const repository = new R2Repository<VideoType>(bucket);

		// With channelIds, the ownership index lists the channels' videos
		// (O(their videos)); the objects are then loaded and go through the same
		// filtering, scoring and sorting as before. Without channelIds, or while
		// the index is incomplete, every R2 page is scanned (bounded). The
		// response `cursor` is an offset into the filtered, sorted results (see
		// pagination below), not an R2 continuation token.
		// SCALABILITY-AUDIT AV-16: candidates come from D1 (the channels' videos,
		// the owner's videos, or the best public matches); a bounded scan only
		// while those indexes are unavailable. Each candidate is one R2 get, so
		// channel and owner searches cover the newest INDEXED_CANDIDATES videos.
		const indexedIds = channelIdList.length > 0
			? await channelsVideoIds(c.env as never, channelIdList, INDEXED_CANDIDATES)
			: isOwner && userId
				? await ownerContentIds(c.env as never, 'video', userId, undefined, INDEXED_CANDIDATES)
				: await publicSearchCandidateIds(c.env, query);
		let videos: { cursor: string; items: VideoType[] };
		if (indexedIds) {
			const loaded = await Promise.all(indexedIds.map(id => repository.getObject(id)));
			videos = { cursor: "", items: loaded.filter((video): video is VideoType => video !== null) };
		} else {
			if (channelIdList.length > 0 || isOwner) scheduleOwnershipHeal(c.env as never, waitUntilOf(c as never), 'video');
			const PAGE = 100;
			const MAX_PAGES = FALLBACK_SCAN_OBJECTS / PAGE;
			videos = await repository.listObjects(PAGE);
			const collected = [...(videos.items || [])];
			let next = videos.cursor;
			let pages = 1;
			while (next && pages < MAX_PAGES) {
				const page = await repository.listObjects(PAGE, next);
				collected.push(...(page.items || []));
				next = page.cursor;
				pages++;
			}
			videos = { ...videos, items: collected, cursor: "" };
		}
		logger.debug('[VideoSearch] Candidates loaded', { source: indexedIds ? 'index' : 'scan', candidates: videos.items.length });

		// Prepare for search scoring
		const searchTerms = query ? query.toLowerCase().trim().split(/\s+/) : [];
		const queryLower = query ? query.toLowerCase() : "";

		// Filter and score videos
		const scoredVideos = (videos.items || [])
			.filter(video => {
				// Soft-deleted and moderation-hidden videos never appear in search
				if (isVideoRemoved(video)) {
					return false;
				}

				// Channel filtering
				if (channelIdList.length > 0 && !channelIdList.includes(video.channelId)) {
					return false;
				}

				// Privacy filter
				if (filter === "public" && video.isPublic === false) return false;
				if (filter === "private" && video.isPublic !== false) return false;

				// Duration filter
				if (durationFilter === "short" && (video.duration === undefined || video.duration > 180)) {
					return false;
				}
				if (durationFilter === "standard" && (video.duration === undefined || video.duration <= 180 || video.isLive)) {
					return false;
				}
				if (durationFilter === "live" && !video.isLive) {
					return false;
				}

				// Schedule filter - filter by scheduled publish status
				if (scheduleFilter !== "all") {
					const scheduledStatus = video.scheduledPublishStatus;

					if (scheduleFilter === "scheduled") {
						// Show only videos that are scheduled or currently publishing
						if (scheduledStatus !== "scheduled" && scheduledStatus !== "publishing") {
							return false;
						}
					}

					if (scheduleFilter === "published") {
						// Show only videos that are NOT scheduled or publishing
						// (i.e., they're already published or have no schedule status)
						if (scheduledStatus === "scheduled" || scheduledStatus === "publishing") {
							return false;
						}
					}
				}

				// If video is private, only show if user owns it
				if (video.isPublic === false) {
					return userId && video.userId === userId;
				}

				return true;
			})
			.map(video => {
				// Calculate relevance score
				let score = 0;

				// If no query provided, all videos get base score
				if (!query) {
					score = 1;
				} else {
					const title = (video.title || "").toLowerCase();
					const description = (video.description || "").toLowerCase();

					// Score based on exact phrase match (highest weight)
					if (title.includes(queryLower)) score += 100;
					if (description.includes(queryLower)) score += 50;

					// Score based on individual term matches
					searchTerms.forEach(term => {
						if (title.includes(term)) score += 20;
						if (description.includes(term)) score += 10;

						// Boost if term appears at beginning of title
						if (title.startsWith(term)) score += 30;
					});

					// Boost popular videos slightly, but only ones that matched:
					// boosting every video let any query match all viewed videos
					if (score > 0) score += Math.min(video.views || 0, 100) * 0.1;
				}

				return { video, score };
			})
			.filter(item => !query || item.score > 0); // Only filter by score if query is provided

		// Sort based on sort parameter
		scoredVideos.sort((a, b) => {
			switch (sort) {
				case "relevance":
					// If no query, fall back to date sorting
					if (!query) {
						return new Date(b.video.dateCreated || 0).getTime() - new Date(a.video.dateCreated || 0).getTime();
					}
					return b.score - a.score;
				case "date":
					return new Date(b.video.dateCreated || 0).getTime() - new Date(a.video.dateCreated || 0).getTime();
				case "views":
					return (b.video.views || 0) - (a.video.views || 0);
				case "title":
					return (a.video.title || "").localeCompare(b.video.title || "");
				default:
					if (!query) {
						return new Date(b.video.dateCreated || 0).getTime() - new Date(a.video.dateCreated || 0).getTime();
					}
					return b.score - a.score;
			}
		});

		// Apply pagination
		const totalResults = scoredVideos.length;
		const startIndex = cursor ? parseInt(cursor) || 0 : 0;
		const endIndex = Math.min(startIndex + limit, totalResults);
		const paginatedVideos = scoredVideos.slice(startIndex, endIndex);

		// Fetch channel data for paginated videos
		const uniqueChannelIds = [...new Set(paginatedVideos.map(v => v.video.channelId).filter(Boolean))];
		const channelMap = new Map<string, Channel>();

		if (uniqueChannelIds.length > 0) {
			const channelBucket = c.env.channels;
			const channelRepo = new R2Repository<Channel>(channelBucket);

			// Fetch channels in parallel
			const channelPromises = uniqueChannelIds.map(async (channelId) => {
				try {
					const channel = await channelRepo.getObject(channelId);
					if (channel) {
						channelMap.set(channelId, channel);
					}
				} catch (error) {
					logger.warn('[VideoSearch] Failed to fetch channel', { channelId, error });
				}
			});

			await Promise.all(channelPromises);
		}

		// Transform to view models
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

		// No queue message per search: the processor only logged it, and per-read
		// messages cost queue operations and processor invocations.

		const searchTime = Date.now() - startTime;
		const nextCursor = endIndex < totalResults ? endIndex.toString() : "";

		return {
			query: query || "",
			totalResults,
			searchTime,
			cursor: nextCursor,
			limit,
			data: paginatedVideos.map(item => transformToView(item.video)),
		};
	}
}
