import { OpenAPIRoute, Num, Str } from "chanfana";
import { z } from "zod";
import { VideoObject, VideoCategory } from "@al-ummah/shared-types";
import R2Repository from "../../lib/r2Repo";
import { IndexManager, INDEX_STALENESS_THRESHOLD } from "../../lib/indexManager";
import { processTrendingVideos, processTimeWindowTrendingVideos, processCategoryTrendingVideos } from "../../lib/trendingAlgorithm";
import { logger } from "../../lib/logger";

const TrendingMetadataSchema = z.object({
  rank: z.number(),
  score: z.number(),
  viewsVelocity: z.number(),
  percentageIncrease: z.number(),
  peakTime: z.string().optional(),
});

const TrendingVideoResponseSchema = z.object({
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
  trendingMetadata: TrendingMetadataSchema,
});

const TrendingVideosResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(TrendingVideoResponseSchema),
  cursor: z.string().optional(),
  metadata: z.object({
    algorithmVersion: z.string(),
    lastCalculated: z.string(),
    nextUpdate: z.string(),
    fromIndex: z.boolean(),
  }),
});

export class TrendingVideosSection extends OpenAPIRoute {
  schema = {
    tags: ["Video Sections"],
    summary: "Get Trending Videos",
    description: "Get trending videos based on velocity, engagement, and recency algorithms.",
    request: {
      query: z.object({
        limit: Num({
          description: "Number of videos to return (1-50)",
          default: 12,
        }),
        cursor: Str({
          description: "Pagination cursor from previous response",
        }).optional(),
        algorithm: z.enum(['velocity', 'engagement', 'hybrid']).optional().default('hybrid').describe("Trending algorithm to use"),
        timeWindow: z.enum(['6h', '12h', '24h', '48h']).optional().default('24h').describe("Time window for trending calculation"),
        category: z.nativeEnum(VideoCategory).optional().describe("Filter by video category"),
        region: Str({
          description: "Geographic region for trending (future enhancement)",
        }).optional(),
      }),
    },
    responses: {
      "200": {
        description: "Returns trending videos with metadata",
        content: {
          "application/json": {
            schema: TrendingVideosResponseSchema,
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

  async handle(c: any) {
    try {
      // Get validated data
      const data = await this.getValidatedData<typeof this.schema>();
      const { limit, cursor, algorithm = 'hybrid', timeWindow = '24h', category, region } = data.query;

      // Parse time window to hours
      const timeWindowHours = parseTimeWindow(timeWindow);

      // Initialize managers
      const videoBucket = c.env.videos;
      const indexManager = new IndexManager(videoBucket);
      const videoRepo = new R2Repository<VideoObject>(videoBucket);

      // Try to get from index first
      const trendingIndex = await indexManager.getTrendingVideosIndex();
      let trendingVideos: any[] = [];
      let fromIndex = false;

      if (trendingIndex && !indexManager.isIndexStale(trendingIndex.lastUpdated, INDEX_STALENESS_THRESHOLD.trending)) {
        // Use index data
        logger.info("Using trending videos index", { algorithm: trendingIndex.algorithm, indexVideos: trendingIndex.videos.length });
        fromIndex = true;

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
        const pageVideos = trendingIndex.videos.slice(startIndex, endIndex);

        // Fetch full video objects and merge with trending metadata
        trendingVideos = await Promise.all(
          pageVideos.map(async (trendingVideo, index) => {
            const video = await videoRepo.getObject(trendingVideo.videoId);
            if (!video) return null;

            // Apply category filter
            if (category && video.category !== category) return null;

            return {
              ...video,
              trendingMetadata: {
                rank: startIndex + index + 1,
                score: trendingVideo.trendingScore,
                viewsVelocity: trendingVideo.viewsVelocity,
                percentageIncrease: Math.round(trendingVideo.viewsVelocity * 10), // Estimated
                peakTime: undefined, // Would need historical data
              },
            };
          })
        ).then(results => results.filter(v => v !== null));

        // Create next cursor if there are more results
        const nextCursor = endIndex < trendingIndex.videos.length
          ? btoa(JSON.stringify({ offset: endIndex }))
          : undefined;

        const nextUpdateTime = new Date(Date.now() + INDEX_STALENESS_THRESHOLD.trending * 60 * 1000).toISOString();

        return c.json({
          success: true,
          data: trendingVideos.map(transformTrendingVideoForResponse),
          cursor: nextCursor,
          metadata: {
            algorithmVersion: "1.0.0",
            lastCalculated: trendingIndex.lastUpdated,
            nextUpdate: nextUpdateTime,
            fromIndex: true,
          },
        });
      } else {
        // Fall back to direct calculation
        logger.info("Index stale or not found, calculating trending videos", { algorithm, timeWindow });
        fromIndex = false;

        // Fetch videos for trending calculation
        const allVideos: VideoObject[] = [];
        let fetchCursor: string | undefined;
        let iterations = 0;

        while (iterations < 10) { // Limit iterations
          const result = await videoRepo.listObjects(100, fetchCursor);
          allVideos.push(...(result.items || []));

          if (!result.cursor) break;
          fetchCursor = result.cursor;
          iterations++;
        }

        // Calculate trending based on parameters
        let trendingData;
        if (category) {
          trendingData = processCategoryTrendingVideos(allVideos, category, algorithm, limit);
        } else if (timeWindow !== '24h') {
          trendingData = processTimeWindowTrendingVideos(allVideos, timeWindowHours, algorithm, limit);
        } else {
          trendingData = processTrendingVideos(allVideos, algorithm, limit);
        }

        // Map trending data to full video objects
        trendingVideos = await Promise.all(
          trendingData.map(async (trending) => {
            const video = allVideos.find(v => v.id === trending.videoId);
            if (!video) return null;

            return {
              ...video,
              trendingMetadata: {
                rank: trending.rank || 0,
                score: trending.trendingScore,
                viewsVelocity: trending.viewsVelocity,
                percentageIncrease: trending.percentageIncrease,
                peakTime: undefined,
              },
            };
          })
        ).then(results => results.filter(v => v !== null));

        // Trigger index rebuild in background (fire and forget)
        c.executionCtx.waitUntil(
          rebuildTrendingIndex(videoBucket, allVideos, algorithm).catch(err =>
            logger.error("Failed to rebuild trending index", { error: err })
          )
        );

        const nextUpdateTime = new Date(Date.now() + INDEX_STALENESS_THRESHOLD.trending * 60 * 1000).toISOString();

        return c.json({
          success: true,
          data: trendingVideos.map(transformTrendingVideoForResponse),
          cursor: undefined, // No cursor for calculated results
          metadata: {
            algorithmVersion: "1.0.0",
            lastCalculated: new Date().toISOString(),
            nextUpdate: nextUpdateTime,
            fromIndex: false,
          },
        });
      }
    } catch (error) {
      logger.error("Error in trending videos endpoint", { error });
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
 * Parse time window string to hours
 */
function parseTimeWindow(timeWindow: string): number {
  switch (timeWindow) {
    case '6h': return 6;
    case '12h': return 12;
    case '24h': return 24;
    case '48h': return 48;
    default: return 24;
  }
}

/**
 * Transform trending video for response
 */
function transformTrendingVideoForResponse(video: any) {
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
    trendingMetadata: video.trendingMetadata,
  };
}

/**
 * Rebuild trending videos index
 */
async function rebuildTrendingIndex(
  videoBucket: R2Bucket,
  videos: VideoObject[],
  algorithm: 'velocity' | 'engagement' | 'hybrid'
): Promise<void> {
  logger.info("Starting trending index rebuild", { algorithm });

  const indexManager = new IndexManager(videoBucket);
  const trendingData = processTrendingVideos(videos, algorithm, 100);

  // Convert to index format
  const index = {
    id: 'index:trending-videos' as const,
    lastUpdated: new Date().toISOString(),
    algorithm,
    videos: trendingData.map(t => ({
      videoId: t.videoId,
      trendingScore: t.trendingScore,
      viewsVelocity: t.viewsVelocity,
      engagementVelocity: t.engagementVelocity,
      dateCreated: t.dateCreated,
      title: t.title,
      thumbnailUrl: t.thumbnailUrl,
      channelId: t.channelId,
      views: t.views,
      likesCount: t.likesCount,
    })),
  };

  await indexManager.saveIndex(index);
  logger.info("Trending index rebuilt", { totalVideos: trendingData.length });
}