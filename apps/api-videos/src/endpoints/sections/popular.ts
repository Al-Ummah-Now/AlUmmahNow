import { PublicRoute, AppContext } from "../../base";
import { isVideoPubliclyVisible } from "../../lib/visibility";
import { Num, Str } from "chanfana";
import { z } from "zod";
import { VideoObject, VideoCategory } from "@al-ummah/shared-types";
import R2Repository from "../../lib/r2Repo";
import { IndexManager, INDEX_STALENESS_THRESHOLD } from "../../lib/indexManager";
import { logger } from "../../lib/logger";

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
  commentsCount: z.number(),
  duration: z.number().optional(),
  category: z.nativeEnum(VideoCategory).optional(),
  isPublic: z.boolean().optional(),
  engagementRate: z.number().optional(),
});

const PopularVideosResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(VideoResponseSchema),
  cursor: z.string().optional(),
  metadata: z.object({
    totalCount: z.number().optional(),
    lastUpdated: z.string(),
    period: z.enum(['all', 'monthly', 'weekly', 'daily']),
    fromIndex: z.boolean(),
  }),
});

export class PopularVideosSection extends PublicRoute {
  schema = {
    tags: ["Video Sections"],
    summary: "Get Popular Videos",
    description: "Get popular videos based on view count and engagement. Can be filtered by time period.",
    request: {
      query: z.object({
        limit: Num({
          description: "Number of videos to return (1-50)",
          default: 12,
        }),
        cursor: Str({
          description: "Pagination cursor from previous response",
        }).optional(),
        period: z.enum(['all', 'monthly', 'weekly', 'daily']).optional().default('all').describe("Time period for popularity calculation"),
        category: z.nativeEnum(VideoCategory).optional().describe("Filter by video category"),
        minViews: Num({
          description: "Minimum view count threshold",
          default: 0,
        }).optional(),
      }),
    },
    responses: {
      "200": {
        description: "Returns popular videos",
        content: {
          "application/json": {
            schema: PopularVideosResponseSchema,
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
    try {
      // Get validated data
      const data = await this.getValidatedData<typeof this.schema>();
      const { limit, cursor, period = 'all', category, minViews = 0 } = data.query;

      // Initialize managers
      const videoBucket = c.env.videos;
      const indexManager = new IndexManager(videoBucket);
      const videoRepo = new R2Repository<VideoObject>(videoBucket);

      // Try to get from index first
      const popularIndex = await indexManager.getPopularVideosIndex(period);
      let videos: VideoObject[] = [];
      let fromIndex = false;

      if (popularIndex && !indexManager.isIndexStale(popularIndex.lastUpdated, INDEX_STALENESS_THRESHOLD.popular)) {
        // Use index data
        logger.info("Using popular videos index", { period, indexVideos: popularIndex.videos.length });
        fromIndex = true;

        // Apply filters to index data
        let filteredIndexVideos = popularIndex.videos;

        // Filter by minimum views
        if (minViews > 0) {
          filteredIndexVideos = filteredIndexVideos.filter(v => v.views >= minViews);
        }

        // Handle cursor-based pagination
        let startIndex = 0;
        if (cursor) {
          try {
            const decodedCursor = JSON.parse(atob(cursor));
            startIndex = decodedCursor.offset || 0;
          } catch (e) {
            logger.warn("Invalid cursor provided", { cursor });
          }
        }

        const endIndex = startIndex + limit;
        const pageVideos = filteredIndexVideos.slice(startIndex, endIndex);

        // Fetch full video objects for the page
        const videoPromises = pageVideos.map(async (indexVideo) => {
          const video = await videoRepo.getObject(indexVideo.videoId);
          if (video) {
            // Add engagement rate from index
            (video as any).engagementRate = indexVideo.engagementRate;
          }
          return video;
        });

        videos = await Promise.all(videoPromises).then(results =>
          results.filter(v => isVideoPubliclyVisible(v)) as VideoObject[]
        );

        // Apply category filter if needed (not in index)
        if (category) {
          videos = videos.filter(v => v.category === category);
        }

        // Create next cursor if there are more results
        if (endIndex < filteredIndexVideos.length) {
          const nextCursor = btoa(JSON.stringify({ offset: endIndex }));
          return c.json({
            success: true,
            data: videos.map(v => transformVideoForResponse(v, (v as any).engagementRate)),
            cursor: nextCursor,
            metadata: {
              totalCount: filteredIndexVideos.length,
              lastUpdated: popularIndex.lastUpdated,
              period,
              fromIndex: true,
            },
          });
        }
      } else {
        // Fall back to direct R2 query
        logger.info("Index stale or not found, using direct R2 query");
        fromIndex = false;

        // List all videos (limited for performance)
        const listResult = await videoRepo.listObjects(200, cursor);
        videos = listResult.items || [];

        // Filter by time period
        const now = Date.now();
        videos = videos.filter(v => {
          if (!isVideoPubliclyVisible(v)) return false;
          if (category && v.category !== category) return false;
          if (minViews > 0 && (v.views || 0) < minViews) return false;

          if (period === 'all') return true;

          const videoDate = new Date(v.dateCreated || 0).getTime();
          const ageInDays = (now - videoDate) / (1000 * 60 * 60 * 24);

          switch (period) {
            case 'daily': return ageInDays <= 1;
            case 'weekly': return ageInDays <= 7;
            case 'monthly': return ageInDays <= 30;
            default: return true;
          }
        });

        // Calculate engagement rates and sort by views
        videos = videos.map(v => {
          const views = v.views || 0;
          const likes = v.likesCount || 0;
          const comments = v.commentsCount || 0;
          const engagementRate = views > 0 ? ((likes + comments) / views) : 0;
          (v as any).engagementRate = engagementRate;
          return v;
        }).sort((a, b) => (b.views || 0) - (a.views || 0))
          .slice(0, limit);

        // Trigger index rebuild in background (fire and forget)
        c.executionCtx.waitUntil(
          rebuildPopularIndex(videoBucket, period).catch(err =>
            logger.error("Failed to rebuild popular index", { error: err, period })
          )
        );
      }

      return c.json({
        success: true,
        data: videos.map(v => transformVideoForResponse(v, (v as any).engagementRate)),
        cursor: cursor || undefined,
        metadata: {
          totalCount: videos.length,
          lastUpdated: new Date().toISOString(),
          period,
          fromIndex,
        },
      });
    } catch (error) {
      logger.error("Error in popular videos endpoint", { error });
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Internal server error",
        },
        500
      );
    }
  }
}

/**
 * Transform video object for response
 */
function transformVideoForResponse(video: VideoObject, engagementRate?: number) {
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
    commentsCount: video.commentsCount || 0,
    duration: video.duration,
    category: video.category,
    isPublic: video.isPublic !== false,
    engagementRate: engagementRate || 0,
  };
}

/**
 * Rebuild popular videos index
 */
async function rebuildPopularIndex(videoBucket: R2Bucket, period: 'all' | 'monthly' | 'weekly' | 'daily'): Promise<void> {
  logger.info("Starting popular index rebuild", { period });

  const indexManager = new IndexManager(videoBucket);
  const videoRepo = new R2Repository<VideoObject>(videoBucket);

  // Fetch videos for index
  const allVideos: VideoObject[] = [];
  let cursor: string | undefined;
  let iterations = 0;

  while (iterations < 10) { // More iterations for popular videos
    const result = await videoRepo.listObjects(100, cursor);
    allVideos.push(...(result.items || []));

    if (!result.cursor) break;
    cursor = result.cursor;
    iterations++;
  }

  // Update the index
  await indexManager.updatePopularVideosIndex(allVideos, period);
  logger.info("Popular index rebuilt", { period, totalVideos: allVideos.length });
}