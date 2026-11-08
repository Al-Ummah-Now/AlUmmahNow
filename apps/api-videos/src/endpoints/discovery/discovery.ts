import { Num, Str, Bool } from "chanfana";
import { z } from "zod";
import { OptionalAuthRoute, AppContext } from "../../base";
import { logger } from "../../lib/logger";
import {
  DiscoveryVideo,
  TrendingPeriod,
  buildSuggestions,
  loadChannelMap,
  loadChannels,
  loadDiscoverableVideos,
  rankRecommendations,
  rankTrending,
  toVideoResponse,
} from "../../lib/discovery";
import type { SearchDb } from "@al-ummah/shared-types";
import { suggestFromIndex } from "../../lib/search/query";
import { isWatchHistoryPaused } from "../../lib/watch-history";

const ErrorSchema = z.object({ success: z.boolean(), error: z.string() });

const SuggestionSchema = z.object({
  text: z.string(),
  type: z.enum(["query", "channel", "category", "video"]),
  count: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const DiscoveryVideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  channelId: z.string(),
  channelName: z.string().optional(),
  views: z.number(),
  likesCount: z.number(),
  commentsCount: z.number(),
}).passthrough();

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.min(Math.max(n, 1), max);
}

/**
 * GET /api/search/suggestions
 * Typeahead suggestions from public video titles, tags, categories and channel names.
 */
export class SearchSuggestionsGet extends OptionalAuthRoute {
  schema = {
    tags: ["Search"],
    summary: "Search suggestions",
    description: "🔓 Public. Returns typeahead suggestions (channel names, video titles, categories) matching the query by word prefix, served from the search index with Arabic normalisation. Falls back to scanning stored videos when the index is not configured or fails.",
    request: {
      query: z.object({
        q: Str({ description: "Partial search query" }),
        limit: Num({ description: "Maximum suggestions (1-20)", default: 5 }).optional(),
      }),
    },
    responses: {
      "200": {
        description: "Suggestions (empty array when nothing matches)",
        content: { "application/json": { schema: z.array(SuggestionSchema) } },
      },
      "500": { description: "Internal error", content: { "application/json": { schema: ErrorSchema } } },
    },
  };

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const q = (query.q || "").trim();
    const limit = clampLimit(query.limit, 5, 20);
    if (q.length < 1) return c.json([]);

    const db = c.env.SEARCH_DB as SearchDb | undefined;
    if (db) {
      try {
        const suggestions = await suggestFromIndex(db, q, limit);
        logger.info("[SearchSuggestions] Served suggestions from index", { q, count: suggestions.length });
        c.header("Cache-Control", "public, max-age=60");
        return c.json(suggestions);
      } catch (error) {
        logger.warn("[SearchSuggestions] Index lookup failed, falling back to scan", { q, error: error instanceof Error ? error.message : String(error) });
      }
    }

    try {
      const [videos, channels] = await Promise.all([
        loadDiscoverableVideos(c.env.videos),
        loadChannels(c.env.channels),
      ]);
      const suggestions = buildSuggestions(videos, channels, q, limit);
      logger.info("[SearchSuggestions] Served suggestions", { q, count: suggestions.length });
      c.header("Cache-Control", "public, max-age=60");
      return c.json(suggestions);
    } catch (error) {
      logger.error("[SearchSuggestions] Failed to build suggestions", { error, q });
      return c.json({ success: false, error: "Failed to load search suggestions" }, 500);
    }
  }
}

/**
 * GET /api/trending
 * Videos ranked by recency-weighted likes/comments plus view velocity within the period.
 */
export class TrendingGet extends OptionalAuthRoute {
  schema = {
    tags: ["Search"],
    summary: "Trending videos",
    description: "🔓 Public. Ranks public videos by engagement inside the period (likes and comments weighted by how recent they are) plus view velocity for videos published within the period.",
    request: {
      query: z.object({
        period: z.enum(["hour", "day", "week", "month"]).optional().default("day"),
        category: Str({ description: "Optional category filter" }).optional(),
        language: Str({ description: "Optional content language filter (e.g. en, ar)" }).regex(/^[a-z]{2,3}$/).optional(),
        limit: Num({ description: "Maximum videos (1-50)", default: 20 }).optional(),
      }),
    },
    responses: {
      "200": {
        description: "Trending videos (empty when nothing had activity in the period)",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              period: z.string(),
              category: z.string().optional(),
              data: z.array(DiscoveryVideoSchema),
              videos: z.array(DiscoveryVideoSchema),
            }),
          },
        },
      },
      "500": { description: "Internal error", content: { "application/json": { schema: ErrorSchema } } },
    },
  };

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const period = (query.period || "day") as TrendingPeriod;
    const limit = clampLimit(query.limit, 20, 50);

    try {
      const videos = await loadDiscoverableVideos(c.env.videos);
      const ranked = rankTrending(videos, { now: Date.now(), period, category: query.category, language: query.language, limit });
      const channels = await loadChannelMap(c.env.channels, ranked.map(r => r.video.channelId || ""));
      const data = ranked.map(({ video, trending, rank }) => ({
        ...toVideoResponse(video, channels),
        trendingMetadata: { rank, score: trending.score, viewsVelocity: trending.viewsVelocity },
      }));
      logger.info("[Trending] Served trending videos", { period, category: query.category, language: query.language, count: data.length });
      c.header("Cache-Control", "public, max-age=120");
      return c.json({ success: true, period, category: query.category, language: query.language, data, videos: data });
    } catch (error) {
      logger.error("[Trending] Failed to rank trending videos", { error, period });
      return c.json({ success: false, error: "Failed to load trending videos" }, 500);
    }
  }
}

interface WatchEntry {
  videoId?: string;
  userId?: string;
  lastWatchedAt?: string;
}

async function loadWatchHistory(bucket: R2Bucket | undefined, userId: string): Promise<WatchEntry[]> {
  if (!bucket) return [];
  // Watch history entries are stored as `<userId>:<videoId>`.
  const listing = await bucket.list({ prefix: `${userId}:`, limit: 200 });
  const entries = await Promise.all(listing.objects.map(async object => {
    try {
      const body = await bucket.get(object.key);
      return body ? await body.json<WatchEntry>() : null;
    } catch (error) {
      logger.warn("[Recommendations] Unreadable watch history entry", { key: object.key, error });
      return null;
    }
  }));
  return entries
    .filter((entry): entry is WatchEntry => !!entry?.videoId)
    .sort((a, b) => new Date(b.lastWatchedAt || 0).getTime() - new Date(a.lastWatchedAt || 0).getTime());
}

/**
 * GET /api/recommendations
 * Content-based recommendations: same category, same channel, shared tags and
 * title words relative to the seed video and/or the viewer's recent history.
 */
export class RecommendationsGet extends OptionalAuthRoute {
  schema = {
    tags: ["Search"],
    summary: "Recommended videos",
    description: "🔓 Authentication optional. Recommends public videos related to `videoId` (same category, channel, tags). When signed in, the viewer's recent watch history also seeds the profile and `excludeWatched=true` removes videos already watched.",
    request: {
      query: z.object({
        videoId: Str({ description: "Seed video id" }).optional(),
        limit: Num({ description: "Maximum videos (1-50)", default: 12 }).optional(),
        excludeWatched: Bool({ description: "Exclude videos the viewer already watched", default: false }).optional(),
      }),
    },
    responses: {
      "200": {
        description: "Recommended videos (empty when there are no candidates)",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              data: z.array(DiscoveryVideoSchema),
              videos: z.array(DiscoveryVideoSchema),
              basedOn: z.array(z.string()),
            }),
          },
        },
      },
      "500": { description: "Internal error", content: { "application/json": { schema: ErrorSchema } } },
    },
  };

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const limit = clampLimit(query.limit, 12, 50);
    const userId = this.getUserId(c);

    try {
      const videos = await loadDiscoverableVideos(c.env.videos);
      const byId = new Map(videos.map(v => [v.id, v]));
      const seeds: DiscoveryVideo[] = [];
      const basedOn: string[] = [];
      const exclude = new Set<string>();

      if (query.videoId) {
        exclude.add(query.videoId);
        const seed = byId.get(query.videoId) || await c.env.videos.get(query.videoId)
          .then(o => (o ? o.json<DiscoveryVideo>() : null))
          .catch(() => null);
        if (seed) {
          seeds.push(seed);
          basedOn.push("video");
        }
      }

      // While watch history is paused it is not used for recommendations (#242)
      if (userId && !(await isWatchHistoryPaused(c.env.profiles, userId).catch(() => false))) {
        try {
          const history = await loadWatchHistory(c.env.watch_history, userId);
          for (const entry of history.slice(0, 10)) {
            const watched = byId.get(entry.videoId!);
            if (watched) seeds.push(watched);
          }
          if (history.length > 0) basedOn.push("history");
          if (query.excludeWatched) history.forEach(entry => exclude.add(entry.videoId!));
        } catch (error) {
          logger.warn("[Recommendations] Failed to load watch history", { userId, error });
        }
      }

      if (seeds.length === 0) basedOn.push("popular");

      const ranked = rankRecommendations(videos, { seeds, exclude, limit, now: Date.now() });
      const channels = await loadChannelMap(c.env.channels, ranked.map(r => r.video.channelId || ""));
      const data = ranked.map(({ video, score }) => ({ ...toVideoResponse(video, channels), recommendationScore: score }));
      logger.info("[Recommendations] Served recommendations", { videoId: query.videoId, userId, count: data.length, basedOn });
      if (!userId) c.header("Cache-Control", "public, max-age=120");
      return c.json({ success: true, data, videos: data, basedOn });
    } catch (error) {
      logger.error("[Recommendations] Failed to build recommendations", { error, videoId: query.videoId });
      return c.json({ success: false, error: "Failed to load recommendations" }, 500);
    }
  }
}
