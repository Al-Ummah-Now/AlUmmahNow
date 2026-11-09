import { Num, Str } from "chanfana";
import { z } from "zod";
import { AuthenticatedRoute, AppContext } from "../../base";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { logger } from "../../lib/logger";
import { waitUntilOf } from "../../lib/search/ownership";
import {
  AnalyticsChannel,
  AnalyticsVideo,
  buildDailySeries,
  buildRetentionCurve,
  buildSummary,
  buildTraffic,
  engagementRate,
  loadOwnedChannels,
  loadOwnedVideos,
  OwnershipLookup,
  loadRetention,
  loadRollups,
  parseRange,
  rankTopVideos,
  videoAnalytics,
} from "../../lib/analytics";

const ErrorSchema = z.object({ success: z.boolean(), error: z.string() });

const TrafficSchema = z.object({
  totalViews: z.number(),
  sources: z.record(z.number()),
  externalHosts: z.array(z.object({ host: z.string(), views: z.number() })),
});

const RetentionSchema = z.object({
  starts: z.number(),
  points: z.array(z.object({ bucket: z.number(), share: z.number() })).nullable(),
});

const VideoAnalyticsSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  views: z.number(),
  likes: z.number(),
  dislikes: z.number(),
  comments: z.number(),
  shares: z.number(),
  watchTime: z.number().describe("Seconds watched in the requested range"),
  avgViewDuration: z.number().describe("Seconds"),
  clickThroughRate: z.number().describe("Impressions are not tracked; always 0"),
  engagementRate: z.number().describe("(likes + comments) / views, percent"),
  dateCreated: z.string(),
  thumbnailUrl: z.string().optional(),
});

const MetricSchema = z.object({
  date: z.string(),
  views: z.number(),
  likes: z.number(),
  comments: z.number(),
  shares: z.number(),
  subscribers: z.number().describe("New subscribers that day"),
  watchTime: z.number().describe("Seconds"),
});

const RangeQuery = {
  dateFrom: Str({ description: "ISO start date (default: 28 days ago)" }).optional(),
  dateTo: Str({ description: "ISO end date (default: now)" }).optional(),
};

const errorResponses = {
  "401": { description: "Authentication required", content: { "application/json": { schema: ErrorSchema } } },
  "403": { description: "Not the owner", content: { "application/json": { schema: ErrorSchema } } },
  "404": { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  "500": { description: "Internal error", content: { "application/json": { schema: ErrorSchema } } },
};

interface Scope {
  ok: boolean;
  status?: 403 | 404;
  error?: string;
  channels: AnalyticsChannel[];
  videos: AnalyticsVideo[];
}

/**
 * Resolve the channels (and their videos) the user may see analytics for.
 * With `channelId`, the user must own that channel; otherwise all owned channels.
 */
async function loadScope(c: AppContext, userId: string, channelId?: string): Promise<Scope> {
  const lookup: OwnershipLookup = { env: c.env as never, waitUntil: waitUntilOf(c as never) };
  const owned = await loadOwnedChannels(c.env.channels, userId, lookup);
  let channels = owned;
  if (channelId) {
    const match = owned.find(ch => ch.id === channelId);
    if (!match) {
      const exists = await c.env.channels.head(channelId);
      return exists
        ? { ok: false, status: 403, error: "You can only view analytics for channels you own", channels: [], videos: [] }
        : { ok: false, status: 404, error: "Channel not found", channels: [], videos: [] };
    }
    channels = [match];
  }
  const videos = channels.length
    ? await loadOwnedVideos(c.env.videos, userId, new Set(channels.map(ch => ch.id)), undefined, lookup)
    : [];
  return { ok: true, channels, videos };
}

/**
 * GET /api/analytics/summary
 */
export class AnalyticsSummaryGet extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ["Analytics"],
    summary: "Analytics summary",
    description: "🔒 Lifetime totals across the caller's channels (or one owned channel via `channelId`).",
    request: {
      query: z.object({ channelId: Str({ description: "Limit to one owned channel" }).optional(), ...RangeQuery }),
    },
    responses: {
      "200": {
        description: "Summary",
        content: {
          "application/json": {
            schema: z.object({
              totalViews: z.number(),
              totalLikes: z.number(),
              totalComments: z.number(),
              totalSubscribers: z.number(),
              totalVideos: z.number(),
              avgViewsPerVideo: z.number(),
              engagementRate: z.number(),
              topVideo: VideoAnalyticsSchema.nullable(),
            }),
          },
        },
      },
      ...errorResponses,
    },
  });

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const userId = this.getUserId(c);
    try {
      const scope = await loadScope(c, userId, query.channelId);
      if (!scope.ok) return c.json({ success: false, error: scope.error }, scope.status);
      const summary = buildSummary(scope.videos, scope.channels);
      logger.info("[Analytics] Summary served", { userId, channelId: query.channelId, videos: scope.videos.length });
      return c.json(summary);
    } catch (error) {
      logger.error("[Analytics] Summary failed", { userId, error });
      return c.json({ success: false, error: "Failed to load analytics summary" }, 500);
    }
  }
}

/**
 * GET /api/analytics/channels/:channelId
 */
export class AnalyticsChannelGet extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ["Analytics"],
    summary: "Channel analytics",
    description: "🔒 Owner only. Lifetime totals, top videos and the daily series for the range.",
    request: {
      params: z.object({ channelId: Str() }),
      query: z.object(RangeQuery),
    },
    responses: {
      "200": {
        description: "Channel analytics",
        content: {
          "application/json": {
            schema: z.object({
              channelId: z.string(),
              channelName: z.string().optional(),
              totalViews: z.number(),
              totalVideos: z.number(),
              totalSubscribers: z.number(),
              totalLikes: z.number(),
              totalComments: z.number(),
              avgViewsPerVideo: z.number(),
              avgEngagementRate: z.number(),
              topPerformingVideos: z.array(VideoAnalyticsSchema),
              recentMetrics: z.array(MetricSchema),
              traffic: TrafficSchema,
            }),
          },
        },
      },
      ...errorResponses,
    },
  });

  async handle(c: AppContext) {
    const { params, query } = await this.getValidatedData<typeof this.schema>();
    const userId = this.getUserId(c);
    try {
      const scope = await loadScope(c, userId, params.channelId);
      if (!scope.ok) return c.json({ success: false, error: scope.error }, scope.status);
      const range = parseRange(query.dateFrom, query.dateTo);
      const rollups = await loadRollups(c.env, "channel", [params.channelId], range);
      const summary = buildSummary(scope.videos, scope.channels);
      return c.json({
        channelId: params.channelId,
        channelName: scope.channels[0]?.name,
        totalViews: summary.totalViews,
        totalVideos: summary.totalVideos,
        totalSubscribers: summary.totalSubscribers,
        totalLikes: summary.totalLikes,
        totalComments: summary.totalComments,
        avgViewsPerVideo: summary.avgViewsPerVideo,
        avgEngagementRate: summary.engagementRate,
        topPerformingVideos: rankTopVideos(scope.videos, 10),
        recentMetrics: buildDailySeries(range, scope.videos, scope.channels, rollups),
        traffic: buildTraffic(rollups, range),
      });
    } catch (error) {
      logger.error("[Analytics] Channel analytics failed", { userId, channelId: params.channelId, error });
      return c.json({ success: false, error: "Failed to load channel analytics" }, 500);
    }
  }
}

/**
 * GET /api/analytics/videos/:videoId
 */
export class AnalyticsVideoGet extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ["Analytics"],
    summary: "Video analytics",
    description: "🔒 Owner only. Lifetime counters; watch time and average view duration for the range.",
    request: {
      params: z.object({ videoId: Str() }),
      query: z.object(RangeQuery),
    },
    responses: {
      "200": { description: "Video analytics", content: { "application/json": { schema: VideoAnalyticsSchema.extend({ traffic: TrafficSchema }) } } },
      ...errorResponses,
    },
  });

  async handle(c: AppContext) {
    const { params, query } = await this.getValidatedData<typeof this.schema>();
    const userId = this.getUserId(c);
    try {
      const object = await c.env.videos.get(params.videoId);
      const video = object ? await object.json<AnalyticsVideo>() : null;
      if (!video || video.isDeleted) return c.json({ success: false, error: "Video not found" }, 404);
      if (video.userId !== userId) {
        return c.json({ success: false, error: "You can only view analytics for your own videos" }, 403);
      }
      const range = parseRange(query.dateFrom, query.dateTo);
      const rollups = await loadRollups(c.env, "video", [video.id], range);
      return c.json({ ...videoAnalytics(video, rollups), traffic: buildTraffic(rollups, range) });
    } catch (error) {
      logger.error("[Analytics] Video analytics failed", { userId, videoId: params.videoId, error });
      return c.json({ success: false, error: "Failed to load video analytics" }, 500);
    }
  }
}

/**
 * GET /api/analytics/videos/:videoId/retention
 */
export class AnalyticsRetentionGet extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ["Analytics"],
    summary: "Video retention curve",
    description: "🔒 Owner only. Share of viewers still watching at each 5% of the video. No curve below the minimum number of starts.",
    request: {
      params: z.object({ videoId: Str() }),
      query: z.object(RangeQuery),
    },
    responses: {
      "200": { description: "Retention curve", content: { "application/json": { schema: RetentionSchema } } },
      ...errorResponses,
    },
  });

  async handle(c: AppContext) {
    const { params, query } = await this.getValidatedData<typeof this.schema>();
    const userId = this.getUserId(c);
    try {
      const object = await c.env.videos.get(params.videoId);
      const video = object ? await object.json<AnalyticsVideo>() : null;
      if (!video || video.isDeleted) return c.json({ success: false, error: "Video not found" }, 404);
      if (video.userId !== userId) {
        return c.json({ success: false, error: "You can only view analytics for your own videos" }, 403);
      }
      const range = parseRange(query.dateFrom, query.dateTo);
      const docs = await loadRetention(c.env, video.id, range);
      return c.json(buildRetentionCurve(docs, range));
    } catch (error) {
      logger.error("[Analytics] Retention failed", { userId, videoId: params.videoId, error });
      return c.json({ success: false, error: "Failed to load retention" }, 500);
    }
  }
}

/**
 * GET /api/analytics/metrics
 */
export class AnalyticsMetricsGet extends AuthenticatedRoute {
  schema = addAuthToSchema({
    tags: ["Analytics"],
    summary: "Daily analytics metrics",
    description: "🔒 Daily views, watch time (processor rollups), likes, comments and new subscribers for the caller's channels (or one owned channel).",
    request: {
      query: z.object({
        channelId: Str({ description: "Limit to one owned channel" }).optional().nullable(),
        limit: Num({ description: "Return only the most recent N days" }).optional(),
        ...RangeQuery,
      }),
    },
    responses: {
      "200": { description: "Daily metrics, oldest first", content: { "application/json": { schema: z.array(MetricSchema) } } },
      ...errorResponses,
    },
  });

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const userId = this.getUserId(c);
    try {
      const scope = await loadScope(c, userId, query.channelId);
      if (!scope.ok) return c.json({ success: false, error: scope.error }, scope.status);
      const range = parseRange(query.dateFrom, query.dateTo);
      const rollups = await loadRollups(c.env, "channel", scope.channels.map(ch => ch.id), range);
      let series = buildDailySeries(range, scope.videos, scope.channels, rollups);
      if (query.limit && query.limit > 0) series = series.slice(-Math.floor(query.limit));
      return c.json(series);
    } catch (error) {
      logger.error("[Analytics] Metrics failed", { userId, error });
      return c.json({ success: false, error: "Failed to load analytics metrics" }, 500);
    }
  }
}

export { engagementRate };
