import { isShortOrFlag } from "@al-ummah/shared-types";
import { PublicRoute, AppContext } from "../../base";
import { isVideoPubliclyVisible } from "../../lib/visibility";
import { Num, Str } from "chanfana";
import { z } from "zod";
import { VideoObject, VideoCategory } from "@al-ummah/shared-types";
import R2Repository from "../../lib/r2Repo";
import { IndexManager } from "../../lib/indexManager";
import { logger } from "../../lib/logger";
import { emptyShelf } from "../../lib/shelf";
import { sectionFromIndex, decodeOffset, encodeOffset } from "../../lib/sections/sectionIndex";

const VideoResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  channelId: z.string(),
  channelName: z.string().optional(),
  channelAvatarUrl: z.string().optional(),
  dateCreated: z.string(),
  views: z.number(),
  likesCount: z.number(),
  dislikesCount: z.number(),
  isShort: z.boolean().optional(),
  commentsCount: z.number(),
  duration: z.number().optional(),
  category: z.nativeEnum(VideoCategory).optional(),
  isPublic: z.boolean().optional(),
});

const CategoryVideosResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(VideoResponseSchema),
  cursor: z.string().optional(),
  metadata: z.object({
    category: z.nativeEnum(VideoCategory),
    totalCount: z.number().optional(),
    lastUpdated: z.string(),
    sortBy: z.enum(['recent', 'popular', 'trending']),
    fromIndex: z.boolean(),
  }),
});

export class CategoryVideosSection extends PublicRoute {
  schema = {
    tags: ["Video Sections"],
    summary: "Get Videos by Category",
    description: "Get videos filtered by a specific category with various sorting options.",
    request: {
      params: z.object({
        category: z.nativeEnum(VideoCategory).describe("Video category to filter by"),
      }),
      query: z.object({
        limit: Num({
          description: "Number of videos to return (1-50)",
          default: 12,
        }),
        cursor: Str({
          description: "Pagination cursor from previous response",
        }).optional(),
        sort: z.enum(['recent', 'popular', 'trending']).optional().default('recent').describe("Sort order for videos"),
        subCategory: Str({
          description: "Sub-category for more granular filtering (future enhancement)",
        }).optional(),
      }),
    },
    responses: {
      "200": {
        description: "Returns videos in the specified category",
        content: {
          "application/json": {
            schema: CategoryVideosResponseSchema,
          },
        },
      },
      "400": {
        description: "Bad request - invalid parameters",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
      "404": {
        description: "Category not found",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
      "500": {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    // Validation stays outside the try: invalid input is a 400 from chanfana
    const data = await this.getValidatedData<typeof this.schema>();
    try {
      const { category } = data.params;
      const { limit, cursor, sort = 'recent', subCategory } = data.query;

      // Validate category exists in enum
      if (!Object.values(VideoCategory).includes(category)) {
        return c.json(
          {
            success: false,
            error: `Invalid category: ${category}`,
          },
          404
        );
      }

      // Initialize managers
      const videoBucket = c.env.videos;
      const indexManager = new IndexManager(videoBucket);
      const videoRepo = new R2Repository<VideoObject>(videoBucket);

      // From the D1 search index when it is bound (SCALABILITY-AUDIT AV-15)
      const page = await sectionFromIndex(c.env, { sort, limit, offset: decodeOffset(cursor), category });
      if (page) {
        return c.json({
          success: true,
          data: page.videos.map(transformVideoForResponse),
          cursor: page.nextOffset !== undefined ? encodeOffset(page.nextOffset) : undefined,
          metadata: { category, totalCount: page.total, lastUpdated: new Date().toISOString(), sortBy: sort, fromIndex: true },
        });
      }

      // Without it: the stored R2 index even when stale, else one page of the bucket;
      // never a rebuild on the request path
      const categoryIndex = await indexManager.getCategoryVideosIndex(category);
      let videos: VideoObject[] = [];
      let fromIndex = false;

      if (categoryIndex) {
        // Use index data
        logger.debug("Using category videos index", { category, indexVideos: categoryIndex.videos.length });
        fromIndex = true;

        // Sort index data based on sort parameter
        let sortedIndexVideos = [...categoryIndex.videos];

        switch (sort) {
          case 'popular':
            sortedIndexVideos.sort((a, b) => b.views - a.views);
            break;
          case 'trending':
            // Sort by combination of views and recency
            sortedIndexVideos.sort((a, b) => {
              const scoreA = calculateTrendingScore(a);
              const scoreB = calculateTrendingScore(b);
              return scoreB - scoreA;
            });
            break;
          case 'recent':
          default:
            sortedIndexVideos.sort((a, b) => {
              const dateA = new Date(a.dateCreated).getTime();
              const dateB = new Date(b.dateCreated).getTime();
              return dateB - dateA;
            });
            break;
        }

        // Handle cursor-based pagination
        let startIndex = 0;
        if (cursor) {
          try {
            const decodedCursor = JSON.parse(atob(cursor));
            startIndex = decodedCursor.offset || 0;
          } catch (e) {
            logger.debug("Invalid cursor provided", { cursor });
          }
        }

        const endIndex = startIndex + limit;
        const pageVideos = sortedIndexVideos.slice(startIndex, endIndex);

        // Fetch full video objects for the page
        videos = await Promise.all(
          pageVideos.map(async (indexVideo) => {
            const video = await videoRepo.getObject(indexVideo.videoId);
            return video;
          })
        ).then(results => results.filter(v => isVideoPubliclyVisible(v)) as VideoObject[]);

        // Create next cursor if there are more results
        if (endIndex < sortedIndexVideos.length) {
          const nextCursor = btoa(JSON.stringify({ offset: endIndex }));
          return c.json({
            success: true,
            data: videos.map(transformVideoForResponse),
            cursor: nextCursor,
            metadata: {
              category,
              totalCount: sortedIndexVideos.length,
              lastUpdated: categoryIndex.lastUpdated,
              sortBy: sort,
              fromIndex: true,
            },
          });
        }
      } else {
        // Fall back to direct R2 query
        logger.debug("Category index stale or not found, using direct R2 query", { category });
        fromIndex = false;

        // List videos and filter by category
        const allVideos: VideoObject[] = [];
        let fetchCursor: string | undefined;
        let iterations = 0;

        while (iterations < 1) { // One page: a bounded fallback while the search index is unavailable
          const result = await videoRepo.listObjects(100, fetchCursor);
          const categoryVideos = (result.items || []).filter(v =>
            v.category === category && isVideoPubliclyVisible(v)
          );
          allVideos.push(...categoryVideos);

          if (!result.cursor) break;
          fetchCursor = result.cursor;
          iterations++;
        }

        // Sort based on sort parameter
        switch (sort) {
          case 'popular':
            allVideos.sort((a, b) => (b.views || 0) - (a.views || 0));
            break;
          case 'trending':
            allVideos.sort((a, b) => {
              const scoreA = calculateFullTrendingScore(a);
              const scoreB = calculateFullTrendingScore(b);
              return scoreB - scoreA;
            });
            break;
          case 'recent':
          default:
            allVideos.sort((a, b) => {
              const dateA = new Date(a.dateCreated || 0).getTime();
              const dateB = new Date(b.dateCreated || 0).getTime();
              return dateB - dateA;
            });
            break;
        }

        // Apply pagination
        videos = allVideos.slice(0, limit);

      }

      return c.json({
        success: true,
        data: videos.map(transformVideoForResponse),
        cursor: cursor || undefined,
        metadata: {
          category,
          totalCount: videos.length,
          lastUpdated: new Date().toISOString(),
          sortBy: sort,
          fromIndex,
        },
      });
    } catch (error) {
      return emptyShelf(c, "by-category", error);
    }
  }
}

/**
 * Calculate simple trending score for index data
 */
function calculateTrendingScore(video: {
  views: number;
  likesCount: number;
  dateCreated: string;
}): number {
  const ageInDays = (Date.now() - new Date(video.dateCreated).getTime()) / (1000 * 60 * 60 * 24);
  const recencyBonus = Math.max(0, 100 - ageInDays * 10);
  return video.views + (video.likesCount * 10) + recencyBonus;
}

/**
 * Calculate full trending score for video objects
 */
function calculateFullTrendingScore(video: VideoObject): number {
  const views = video.views || 0;
  const likes = video.likesCount || 0;
  const comments = video.commentsCount || 0;
  const dateCreated = video.dateCreated || new Date().toISOString();

  const ageInDays = (Date.now() - new Date(dateCreated).getTime()) / (1000 * 60 * 60 * 24);
  const recencyBonus = Math.max(0, 100 - ageInDays * 10);
  const engagementScore = likes + (comments * 2);

  return views + (engagementScore * 10) + recencyBonus;
}

/**
 * Transform video object for response
 */
function transformVideoForResponse(video: VideoObject) {
  return {
    id: video.id,
    title: video.title || '',
    description: video.description,
    thumbnailUrl: video.thumbnailUrl,
    videoUrl: video.videoUrl,
    channelId: video.channelId || '',
    channelName: video.channelName,
    channelAvatarUrl: video.channelAvatarUrl,
    dateCreated: video.dateCreated || new Date().toISOString(),
    views: video.views || 0,
    likesCount: video.likesCount || 0,
    dislikesCount: video.dislikesCount || 0,
    // Shared rule (search payloads carry it; older entries are computed)
    isShort: isShortOrFlag(video),
    commentsCount: video.commentsCount || 0,
    duration: video.duration,
    category: video.category,
    isPublic: video.isPublic !== false,
  };
}
