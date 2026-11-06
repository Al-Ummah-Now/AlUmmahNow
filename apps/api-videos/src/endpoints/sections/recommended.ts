import { OptionalAuthRoute, AppContext } from "../../base";
import { Num, Str, Bool } from "chanfana";
import { z } from "zod";
import { VideoObject, VideoCategory } from "@al-ummah/shared-types";
import R2Repository from "../../lib/r2Repo";
import { IndexManager } from "../../lib/indexManager";
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
  recommendationScore: z.number().optional(),
});

const RecommendedVideosResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(VideoResponseSchema),
  cursor: z.string().optional(),
  metadata: z.object({
    strategy: z.enum(['popular', 'category-based', 'random']),
    basedOn: z.string().optional(),
    lastUpdated: z.string(),
  }),
});

export class RecommendedVideosSection extends OptionalAuthRoute {
  schema = {
    tags: ["Video Sections"],
    summary: "Get Recommended Videos",
    description: "Get recommended videos. MVP implementation uses popular videos or category-based recommendations.",
    request: {
      query: z.object({
        limit: Num({
          description: "Number of videos to return (1-50)",
          default: 12,
        }),
        cursor: Str({
          description: "Pagination cursor from previous response",
        }).optional(),
        strategy: z.enum(['popular', 'category-based', 'random']).optional().default('popular').describe("Recommendation strategy"),
        excludeWatched: Bool({
          description: "Exclude user's watch history (requires auth)",
          default: false,
        }).optional(),
        seedVideoId: Str({
          description: "Base recommendations on this video",
        }).optional(),
      }),
      headers: z.object({}),
    },
    responses: {
      "200": {
        description: "Returns recommended videos",
        content: {
          "application/json": {
            schema: RecommendedVideosResponseSchema,
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
      const { limit, cursor, strategy = 'popular', excludeWatched = false, seedVideoId } = data.query;
      const userId = this.getUserId(c);

      // Initialize managers
      const videoBucket = c.env.videos;
      const indexManager = new IndexManager(videoBucket);
      const videoRepo = new R2Repository<VideoObject>(videoBucket);

      let recommendedVideos: VideoObject[] = [];
      let basedOn: string | undefined;
      let watchedVideoIds: Set<string> = new Set();

      // Get user's watch history if excludeWatched is true and user is authenticated
      if (excludeWatched && userId) {
        try {
          const watchHistoryBucket = c.env.watch_history;
          if (watchHistoryBucket) {
            const watchHistory = await getWatchHistory(watchHistoryBucket, userId);
            watchedVideoIds = new Set(watchHistory);
            logger.info("Loaded watch history for recommendations", { userId, watchedCount: watchedVideoIds.size });
          }
        } catch (error) {
          logger.warn("Failed to load watch history", { error, userId });
        }
      }

      // Get seed video if provided
      let seedVideo: VideoObject | null = null;
      if (seedVideoId) {
        seedVideo = await videoRepo.getObject(seedVideoId);
        if (seedVideo) {
          basedOn = `Video: ${seedVideo.title || seedVideoId}`;
        }
      }

      switch (strategy) {
        case 'category-based':
          recommendedVideos = await getCategoryBasedRecommendations(
            indexManager,
            videoRepo,
            seedVideo,
            limit,
            cursor,
            watchedVideoIds
          );
          if (!basedOn && seedVideo?.category) {
            basedOn = `Category: ${seedVideo.category}`;
          }
          break;

        case 'random':
          recommendedVideos = await getRandomRecommendations(
            videoRepo,
            limit,
            cursor,
            watchedVideoIds
          );
          basedOn = "Random selection";
          break;

        case 'popular':
        default:
          // Use popular videos as recommendations (MVP approach)
          const popularIndex = await indexManager.getPopularVideosIndex('weekly');

          if (popularIndex) {
            // Use popular videos from index
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
            const pageVideos = popularIndex.videos
              .filter(v => !watchedVideoIds.has(v.videoId))
              .slice(startIndex, endIndex);

            // Fetch full video objects
            recommendedVideos = await Promise.all(
              pageVideos.map(async (indexVideo) => {
                const video = await videoRepo.getObject(indexVideo.videoId);
                if (video) {
                  // Add recommendation score based on popularity
                  (video as any).recommendationScore = calculateRecommendationScore(video, indexVideo.engagementRate);
                }
                return video;
              })
            ).then(results => results.filter(v => v !== null) as VideoObject[]);

            basedOn = "Weekly popular videos";
          } else {
            // Fallback to direct query
            const listResult = await videoRepo.listObjects(limit * 2, cursor);
            recommendedVideos = (listResult.items || [])
              .filter(v => v.isPublic !== false && !watchedVideoIds.has(v.id))
              .sort((a, b) => (b.views || 0) - (a.views || 0))
              .slice(0, limit);

            basedOn = "Popular videos";
          }
          break;
      }

      // Add recommendation scores if not already present
      recommendedVideos = recommendedVideos.map(video => {
        if (!(video as any).recommendationScore) {
          (video as any).recommendationScore = calculateRecommendationScore(video);
        }
        return video;
      });

      return c.json({
        success: true,
        data: recommendedVideos.map(transformVideoForResponse),
        cursor: undefined, // Simple implementation for MVP
        metadata: {
          strategy,
          basedOn,
          lastUpdated: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Error in recommended videos endpoint", { error });
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
 * Get category-based recommendations
 */
async function getCategoryBasedRecommendations(
  indexManager: IndexManager,
  videoRepo: R2Repository<VideoObject>,
  seedVideo: VideoObject | null,
  limit: number,
  cursor: string | undefined,
  excludeIds: Set<string>
): Promise<VideoObject[]> {
  // If we have a seed video with a category, use it
  const category = seedVideo?.category;

  if (category) {
    // Try to get from category index
    const categoryIndex = await indexManager.getCategoryVideosIndex(category);

    if (categoryIndex) {
      const filteredVideos = categoryIndex.videos.filter(v => !excludeIds.has(v.videoId));
      const videos = await Promise.all(
        filteredVideos.slice(0, limit).map(v => videoRepo.getObject(v.videoId))
      );
      return videos.filter(v => v !== null) as VideoObject[];
    }
  }

  // Fallback to popular videos
  const popularIndex = await indexManager.getPopularVideosIndex('weekly');
  if (popularIndex) {
    const videos = await Promise.all(
      popularIndex.videos
        .filter(v => !excludeIds.has(v.videoId))
        .slice(0, limit)
        .map(v => videoRepo.getObject(v.videoId))
    );
    return videos.filter(v => v !== null) as VideoObject[];
  }

  return [];
}

/**
 * Get random recommendations
 */
async function getRandomRecommendations(
  videoRepo: R2Repository<VideoObject>,
  limit: number,
  cursor: string | undefined,
  excludeIds: Set<string>
): Promise<VideoObject[]> {
  // Fetch more videos than needed to account for filtering
  const listResult = await videoRepo.listObjects(limit * 3, cursor);
  const videos = (listResult.items || [])
    .filter(v => v.isPublic !== false && !excludeIds.has(v.id));

  // Shuffle array
  for (let i = videos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [videos[i], videos[j]] = [videos[j], videos[i]];
  }

  return videos.slice(0, limit);
}

/**
 * Get user's watch history
 */
async function getWatchHistory(watchHistoryBucket: R2Bucket, userId: string): Promise<string[]> {
  try {
    // Watch history entries are stored one per video with key `<userId>:<videoId>`
    const prefix = `${userId}:`;
    const listing = await watchHistoryBucket.list({ prefix, limit: 1000 });
    return listing.objects.map(object => object.key.slice(prefix.length)).filter(Boolean);
  } catch (error) {
    logger.error("Failed to get watch history", { error, userId });
    return [];
  }
}

/**
 * Calculate recommendation score
 */
function calculateRecommendationScore(video: VideoObject, engagementRate?: number): number {
  const views = video.views || 0;
  const likes = video.likesCount || 0;
  const comments = video.commentsCount || 0;

  // Simple scoring for MVP
  const viewScore = Math.min(100, views / 1000);
  const engagementScore = engagementRate ? engagementRate * 100 : ((likes + comments) / Math.max(1, views)) * 100;
  const recencyScore = getRecencyScore(video.dateCreated);

  return Math.round((viewScore * 0.4) + (engagementScore * 0.4) + (recencyScore * 0.2));
}

/**
 * Get recency score based on video age
 */
function getRecencyScore(dateCreated?: string): number {
  if (!dateCreated) return 0;

  const ageInDays = (Date.now() - new Date(dateCreated).getTime()) / (1000 * 60 * 60 * 24);

  if (ageInDays < 1) return 100;
  if (ageInDays < 7) return 80;
  if (ageInDays < 30) return 60;
  if (ageInDays < 90) return 40;
  return 20;
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
    commentsCount: video.commentsCount || 0,
    duration: video.duration,
    category: video.category,
    isPublic: video.isPublic !== false,
    recommendationScore: (video as any).recommendationScore || 0,
  };
}