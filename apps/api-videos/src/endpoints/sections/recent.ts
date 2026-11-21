import { CATEGORY_SLUG_PATTERN } from "@al-ummah/shared-types";
import { PublicRoute, AppContext } from "../../base";
import { isVideoPubliclyVisible } from "../../lib/visibility";
import { Num, Str } from "../../lib/chanfana-params";
import { z } from "zod";
import { VideoObject, VideoCategory } from "@al-ummah/shared-types";
import R2Repository from "../../lib/r2Repo";
import { IndexManager } from "../../lib/indexManager";
import { logger } from "../../lib/logger";
import { emptyShelf } from "../../lib/shelf";
import { sectionFromIndex, decodeOffset, encodeOffset } from "../../lib/sections/sectionIndex";
import { FeedVideoFields, RailInfoSchema, feedItem, railItems, readRail } from "../../lib/ranking/sectionResponse";
import { railLabelFields, railScope } from "../../lib/ranking/serve";

const VideoResponseSchema = z.object({
  ...FeedVideoFields,
});

const RecentVideosResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(VideoResponseSchema),
  cursor: z.string().optional(),
  metadata: z.object({
    totalCount: z.number().optional(),
    lastUpdated: z.string(),
    fromIndex: z.boolean(),
    rail: RailInfoSchema.optional(),
  }),
});

export class RecentVideosSection extends PublicRoute {
  schema = {
    tags: ["Video Sections"],
    summary: "Get Recent Videos",
    description: "Get recently uploaded videos. This endpoint returns the most recent public videos, optionally filtered by channel or category.",
    request: {
      query: z.object({
        limit: Num({
          description: "Number of videos to return (1-50)",
          default: 12,
        }),
        cursor: Str({
          description: "Pagination cursor from previous response",
        }).optional(),
        channelId: Str({
          description: "Filter by specific channel ID",
        }).optional(),
        category: z.string().regex(CATEGORY_SLUG_PATTERN).optional().describe("Filter by video category"),
        excludeChannels: z.array(z.string()).optional().describe("Exclude specific channel IDs"),
      }),
    },
    responses: {
      "200": {
        description: "Returns recent videos",
        content: {
          "application/json": {
            schema: RecentVideosResponseSchema,
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
    // Validation stays outside the try: invalid input is a 400 from chanfana
    const data = await this.getValidatedData<typeof this.schema>();
    try {
      const { limit, cursor, channelId, category, excludeChannels } = data.query;

      // Ranked rails (wiki E07 "Discovery ranking"): new arrivals (an import counts from its arrival, not its old
      // publish date), mixed across channels. A channel's own list or an exclusion list keeps the index query.
      if (!channelId && !(excludeChannels && excludeChannels.length)) {
        const ranked = await readRail(c, { rail: 'new', scope: railScope({ category }), limit, cursor });
        if (ranked) {
          return c.json({
            success: true,
            data: railItems(ranked),
            cursor: ranked.nextCursor,
            metadata: { totalCount: ranked.meta.items, lastUpdated: ranked.meta.computedAt, fromIndex: true, rail: railLabelFields(ranked.meta) },
          });
        }
      }

      // Initialize managers
      const videoBucket = c.env.videos;
      const indexManager = new IndexManager(videoBucket);
      const videoRepo = new R2Repository<VideoObject>(videoBucket);

      // From the D1 search index when it is bound (SCALABILITY-AUDIT AV-15)
      const page = await sectionFromIndex(c.env, { sort: 'recent', limit, offset: decodeOffset(cursor), category, channelId, excludeChannels });
      if (page) {
        return c.json({
          success: true,
          data: page.videos.map(transformVideoForResponse),
          cursor: page.nextOffset !== undefined ? encodeOffset(page.nextOffset) : undefined,
          metadata: { totalCount: page.total, lastUpdated: new Date().toISOString(), fromIndex: true },
        });
      }

      // Without it: the stored R2 index even when stale, else one page of the bucket;
      // never a rebuild on the request path
      const recentIndex = await indexManager.getRecentVideosIndex();
      let videos: VideoObject[] = [];
      let fromIndex = false;

      if (recentIndex) {
        // Use index data
        logger.debug("Using recent videos index", { indexVideos: recentIndex.videos.length });
        fromIndex = true;

        // Apply filters to index data
        let filteredIndexVideos = recentIndex.videos;

        if (channelId) {
          filteredIndexVideos = filteredIndexVideos.filter(v => v.channelId === channelId);
        }

        if (excludeChannels && excludeChannels.length > 0) {
          filteredIndexVideos = filteredIndexVideos.filter(v => !excludeChannels.includes(v.channelId));
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
        const pageVideos = filteredIndexVideos.slice(startIndex, endIndex);

        // Fetch full video objects for the page
        videos = await Promise.all(
          pageVideos.map(async (indexVideo) => {
            const video = await videoRepo.getObject(indexVideo.videoId);
            return video;
          })
        ).then(results => results.filter(v => isVideoPubliclyVisible(v)) as VideoObject[]);

        // Apply category filter if needed (not in index)
        if (category) {
          videos = videos.filter(v => v.category === category);
        }

        // Create next cursor if there are more results
        if (endIndex < filteredIndexVideos.length) {
          const nextCursor = btoa(JSON.stringify({ offset: endIndex }));
          return c.json({
            success: true,
            data: videos.map(transformVideoForResponse),
            cursor: nextCursor,
            metadata: {
              totalCount: filteredIndexVideos.length,
              lastUpdated: recentIndex.lastUpdated,
              fromIndex: true,
            },
          });
        }
      } else {
        // Fall back to direct R2 query
        logger.debug("Index stale or not found, using direct R2 query");
        fromIndex = false;

        // List all videos (limited for performance)
        const listResult = await videoRepo.listObjects(100, cursor);
        videos = listResult.items || [];

        // Filter and sort
        videos = videos
          .filter(v => {
            if (!isVideoPubliclyVisible(v)) return false;
            if (channelId && v.channelId !== channelId) return false;
            if (category && v.category !== category) return false;
            if (excludeChannels && excludeChannels.includes(v.channelId || '')) return false;
            return true;
          })
          .sort((a, b) => {
            const dateA = new Date(a.dateCreated || 0).getTime();
            const dateB = new Date(b.dateCreated || 0).getTime();
            return dateB - dateA;
          })
          .slice(0, limit);

      }

      return c.json({
        success: true,
        data: videos.map(transformVideoForResponse),
        cursor: cursor || undefined,
        metadata: {
          totalCount: videos.length,
          lastUpdated: new Date().toISOString(),
          fromIndex,
        },
      });
    } catch (error) {
      return emptyShelf(c, "recent", error);
    }
  }
}

/**
 * Transform video object for response
 */
function transformVideoForResponse(video: VideoObject) {
  return feedItem(video as never);
}
