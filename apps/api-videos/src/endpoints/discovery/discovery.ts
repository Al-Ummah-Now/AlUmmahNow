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
import { parseSuggestionTypes, type SearchDb } from "@al-ummah/shared-types";
import { initialSuggestionsFromIndex, suggestFromIndex, type IndexSuggestion } from "../../lib/search/query";
import { isWatchHistoryPaused } from "../../lib/watch-history";
import { waitUntilOf } from "../../lib/search/ownership";
import { edgeCacheUrl, readEdgeCache, writeEdgeCache } from "../../lib/edge-cache";
import {
  RecentHistory,
  hydrateRanked,
  hydrationCount,
  loadCandidatePool,
  loadRecentHistory,
  recommendationsCachePath,
  seriesNextFromIndex,
} from "../../lib/recommendations";

const ErrorSchema = z.object({ success: z.boolean(), error: z.string() });

const SuggestionSchema = z.object({
  text: z.string(),
  type: z.enum(["query", "channel", "category", "video", "playlist"]),
  id: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  subtitle: z.string().optional(),
  handle: z.string().optional(),
  verified: z.boolean().optional(),
  count: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** Longest input a suggestion lookup reads; longer text is cut (the index caps query words too). */
const SUGGEST_MAX_QUERY = 100;
/** Deepest page a picker can scroll to (OFFSET reads the skipped rows; past this, type to search). */
const INITIAL_MAX_OFFSET = 500;

const DiscoveryVideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  titleLocalized: z.record(z.string()).optional().describe("Title per language (e.g. { en, ar }): show the page language's, else title"),
  channelId: z.string(),
  channelName: z.string().optional(),
  views: z.number(),
  likesCount: z.number(),
  commentsCount: z.number(),
  seriesNext: z.boolean().optional().describe("Recommendations only: the next video of the seed's numbered series (always first); players play it next"),
}).passthrough();

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.min(Math.max(n, 1), max);
}

/**
 * GET /api/search/suggestions
 * Typeahead suggestions from public video titles, channel names and @handles,
 * playlist names and categories.
 */
export class SearchSuggestionsGet extends OptionalAuthRoute {
  schema = {
    tags: ["Search"],
    summary: "Search suggestions",
    description: "🔓 Public. Returns typeahead suggestions matching the query by word prefix, served from the search index with Arabic normalisation (tashkeel, alef forms, taa marbuta, alef maqsura). `types` picks the kinds (video, channel, playlist, category; default channel,video,category) and `channelId` limits videos and playlists to one channel. Only publicly visible items of visible channels are returned. Each suggestion carries the item's id, thumbnail and a subtitle (channel name, or the channel's @handle). Rate limited per client (429 with Retry-After). Falls back to scanning stored videos when the index is not configured or fails. An empty `q` returns a picker's first page instead (pickers open with content): most viewed channels, or with `channelId` that channel's newest videos and playlists (newest public videos without it); page with `offset`, a page shorter than `limit` is the last.",
    request: {
      query: z.object({
        q: Str({ description: "Partial search query; empty for a picker's first page" }).optional().nullable(),
        offset: Num({ description: "Empty q only: suggestions to skip (the next page)" }).optional().nullable(),
        limit: Num({ description: "Maximum suggestions (1-20)", default: 5 }).optional(),
        types: Str({ description: "Comma-separated kinds: video, channel, playlist, category" }).optional(),
        channelId: Str({ description: "Only this channel's videos and playlists" }).optional(),
      }),
    },
    responses: {
      "200": {
        description: "Suggestions (empty array when nothing matches)",
        content: { "application/json": { schema: z.array(SuggestionSchema) } },
      },
      "429": { description: "Too many lookups; retry after Retry-After seconds", content: { "application/json": { schema: ErrorSchema } } },
      "500": { description: "Internal error", content: { "application/json": { schema: ErrorSchema } } },
    },
  };

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const q = (query.q || "").trim().slice(0, SUGGEST_MAX_QUERY);
    const limit = clampLimit(query.limit, 5, 20);
    const types = parseSuggestionTypes(query.types);
    const channelId = query.channelId?.trim() || undefined;

    // Typing sends a lookup per pause; this caps a client that hammers the endpoint
    const limiter = c.env.SUGGEST_LIMITER as RateLimit | undefined;
    if (limiter) {
      const key = (c.get("userId") as string | undefined) || c.req.header("CF-Connecting-IP") || "anonymous";
      const { success } = await limiter.limit({ key: `suggest:${key}` });
      if (!success) {
        logger.debug("[SearchSuggestions] Rate limited", { anonymous: !c.get("userId") });
        return c.json({ success: false, error: "Too many suggestion lookups; try again shortly" }, 429, { "Retry-After": "60" });
      }
    }

    const db = c.env.SEARCH_DB as SearchDb | undefined;
    if (!q) {
      // A picker opening: an index-backed first page; no scan fallback (that would read every video)
      if (!db) return c.json([]);
      const offset = Math.min(Math.max(Math.floor(Number(query.offset) || 0), 0), INITIAL_MAX_OFFSET);
      try {
        const suggestions = await withChannelHandles(c, await initialSuggestionsFromIndex(db, limit, { types, channelId, offset }));
        logger.debug("[SearchSuggestions] Served initial suggestions", { types, channelId, offset, count: suggestions.length });
        c.header("Cache-Control", "public, max-age=60");
        return c.json(suggestions);
      } catch (error) {
        logger.error("[SearchSuggestions] Initial suggestions failed", { types, channelId, error: error instanceof Error ? error.message : String(error) });
        return c.json({ success: false, error: "Failed to load suggestions" }, 500);
      }
    }
    if (db) {
      try {
        const suggestions = await withChannelHandles(c, await suggestFromIndex(db, q, limit, { types, channelId }));
        logger.debug("[SearchSuggestions] Served suggestions from index", { q, types, channelId, count: suggestions.length });
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
      const scoped = channelId ? videos.filter(v => v.channelId === channelId) : videos;
      const allowed = new Set<string>(types);
      const suggestions = buildSuggestions(scoped, channelId ? [] : channels, q, limit * 2)
        .filter(s => allowed.has(s.type))
        .slice(0, limit);
      logger.debug("[SearchSuggestions] Served suggestions", { q, count: suggestions.length });
      c.header("Cache-Control", "public, max-age=60");
      return c.json(suggestions);
    } catch (error) {
      logger.error("[SearchSuggestions] Failed to build suggestions", { error, q });
      return c.json({ success: false, error: "Failed to load search suggestions" }, 500);
    }
  }
}

/**
 * Channel rows indexed before the payload carried the @handle have none; read
 * it from the channel object (at most a few per lookup) so pickers that need
 * the handle (channel team invites) still work until the row is re-indexed.
 */
async function withChannelHandles(c: AppContext, suggestions: IndexSuggestion[]): Promise<IndexSuggestion[]> {
  const missing = suggestions.filter(s => s.type === "channel" && s.id && !s.handle);
  if (missing.length === 0 || !c.env.channels) return suggestions;
  await Promise.all(missing.map(async (s) => {
    try {
      const object = await c.env.channels.get(s.id as string);
      const channel = object ? await object.json<{ handle?: string; isDeleted?: boolean }>() : null;
      const handle = channel && !channel.isDeleted && typeof channel.handle === "string" ? channel.handle.replace(/^@+/, "") : "";
      if (handle) {
        s.handle = handle;
        s.subtitle = `@${handle}`;
      }
    } catch (error) {
      logger.debug("[SearchSuggestions] Channel handle lookup failed", { channelId: s.id, error: error instanceof Error ? error.message : String(error) });
    }
  }));
  return suggestions;
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
      // Ranking reads every stored video (seconds on a large catalogue), and the
      // web app calls this from the server, past the browser cache: keep the
      // answer at the edge for as long as browsers may.
      const cacheUrl = edgeCacheUrl(c.req.url, `trending/${encodeURIComponent(period)}/${encodeURIComponent(query.category || "")}/${encodeURIComponent(query.language || "")}/${limit}`);
      const cached = await readEdgeCache<TrendingBody>(cacheUrl);
      if (cached) {
        c.header("Cache-Control", `public, max-age=${TRENDING_TTL}`);
        c.header("X-Trending-Cache", "HIT");
        return c.json(cached);
      }
      const videos = await loadDiscoverableVideos(c.env.videos);
      const ranked = rankTrending(videos, { now: Date.now(), period, category: query.category, language: query.language, limit });
      const channels = await loadChannelMap(c.env.channels, ranked.map(r => r.video.channelId || ""));
      const data = ranked.map(({ video, trending, rank }) => ({
        ...toVideoResponse(video, channels),
        trendingMetadata: { rank, score: trending.score, viewsVelocity: trending.viewsVelocity },
      }));
      logger.debug("[Trending] Served trending videos", { period, category: query.category, language: query.language, count: data.length });
      const body: TrendingBody = { success: true, period, category: query.category, language: query.language, data, videos: data };
      writeEdgeCache(cacheUrl, body, TRENDING_TTL, waitUntilOf(c as never));
      c.header("Cache-Control", `public, max-age=${TRENDING_TTL}`);
      c.header("X-Trending-Cache", "MISS");
      return c.json(body);
    } catch (error) {
      logger.error("[Trending] Failed to rank trending videos", { error, period });
      return c.json({ success: false, error: "Failed to load trending videos" }, 500);
    }
  }
}

/** Seconds a trending list is reused, at the edge and in browsers. */
const TRENDING_TTL = 120;

interface TrendingBody {
  success: true;
  period: string;
  category?: string;
  language?: string;
  data: unknown[];
  videos: unknown[];
}

/** Seconds a recommendations result is reused (a viewer's own entry is shorter-lived). */
const ANONYMOUS_RECOMMENDATIONS_TTL = 120;
const PERSONAL_RECOMMENDATIONS_TTL = 60;
/**
 * Seconds a short result is reused. A short result may be a passing failure, so
 * it must not be pinned, but a small catalogue is short on every request and
 * still needs some caching. An empty result is never cached.
 */
const SHORT_RECOMMENDATIONS_TTL = 10;

function anonymousRecommendationsCacheControl(count: number, limit: number): string {
  if (count === 0) return "no-store";
  return `public, max-age=${count >= limit ? ANONYMOUS_RECOMMENDATIONS_TTL : SHORT_RECOMMENDATIONS_TTL}`;
}

interface RecommendationsBody {
  success: true;
  data: unknown[];
  videos: unknown[];
  basedOn: string[];
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
    description: "🔓 Authentication optional. Recommends public videos related to `videoId` (same category, channel, tags). When `videoId`'s title is numbered (\"Lesson 1\", \"الدرس ٢\"), the next video of that series in its channel comes first with `seriesNext: true` (n+1, else the next higher number; never a text match like 1 → 11). When signed in, the viewer's recent watch history also seeds the profile and `excludeWatched=true` ranks videos already watched last, listing them only to fill the limit.",
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
    const excludeWatched = query.excludeWatched === true;

    // Anonymous responses must not satisfy a later signed-in request for the same URL.
    c.header("Vary", "Authorization");
    c.header("Cache-Control", userId ? "private, no-store" : `public, max-age=${ANONYMOUS_RECOMMENDATIONS_TTL}`);

    try {
      // While watch history is paused it is not used for recommendations (#242)
      const historyPaused = userId
        ? await isWatchHistoryPaused(c.env.profiles, userId).catch(() => false)
        : false;
      const cacheUrl = edgeCacheUrl(c.req.url, await recommendationsCachePath({
        videoId: query.videoId, limit, userId, historyPaused, excludeWatched,
      }));
      const cached = await readEdgeCache<RecommendationsBody>(cacheUrl);
      if (cached) {
        c.header("X-Recommendations-Cache", "HIT");
        if (!userId) c.header("Cache-Control", anonymousRecommendationsCacheControl(cached.data.length, limit));
        return c.json(cached);
      }

      let history: RecentHistory = { watchedIds: [], seedIds: [] };
      if (userId && !historyPaused) {
        try {
          history = await loadRecentHistory(c.env.watch_history, userId);
        } catch (error) {
          logger.warn("[Recommendations] Failed to load watch history", { userId, error });
        }
      }

      const pool = await loadCandidatePool(c.env, query.videoId, history.seedIds);
      const exclude = new Set<string>(query.videoId ? [query.videoId] : []);
      if (excludeWatched) history.watchedIds.forEach(id => exclude.add(id));

      const basedOn: string[] = [];
      if (query.videoId && pool.seeds.some(seed => seed.id === query.videoId)) basedOn.push("video");
      if (history.watchedIds.length > 0) basedOn.push("history");
      if (pool.seeds.length === 0) basedOn.push("popular");

      const ranked = rankRecommendations(pool.candidates, {
        seeds: pool.seeds,
        exclude,
        limit: hydrationCount(limit),
        now: Date.now(),
      });
      const winners = await hydrateRanked(c.env.videos, ranked, limit);
      if (excludeWatched && winners.length < limit) {
        // Not enough unwatched videos: fill the shelf with watched ones, after them.
        const missing = limit - winners.length;
        const backfill = rankRecommendations(pool.candidates, {
          seeds: pool.seeds,
          exclude: new Set([...(query.videoId ? [query.videoId] : []), ...winners.map(w => w.video.id)]),
          limit: hydrationCount(missing),
          now: Date.now(),
        });
        winners.push(...await hydrateRanked(c.env.videos, backfill, missing));
      }
      // A numbered series continues in order (lib/series.ts): its next video leads the shelf,
      // flagged so every player (web, embed, native) plays it next
      let seriesId: string | null = null;
      const searchDb = c.env.SEARCH_DB as SearchDb | undefined;
      if (query.videoId && searchDb) {
        try {
          seriesId = await seriesNextFromIndex(searchDb, c.env.videos, query.videoId);
        } catch (error) {
          logger.warn("[Recommendations] Series lookup failed", { videoId: query.videoId, error });
        }
      }
      if (seriesId) {
        const at = winners.findIndex(w => w.video.id === seriesId);
        const series = at >= 0
          ? winners.splice(at, 1)[0]
          : (await hydrateRanked(c.env.videos, [{ video: { id: seriesId } as DiscoveryVideo, score: 0 }], 1))[0];
        if (series) {
          winners.unshift(series);
          winners.splice(limit);
        } else {
          seriesId = null;
        }
      }
      const channels = await loadChannelMap(c.env.channels, winners.map(r => r.video.channelId || ""));
      const data = winners.map(({ video, score }) => ({
        ...toVideoResponse(video, channels),
        recommendationScore: score,
        ...(video.id === seriesId ? { seriesNext: true } : {}),
      }));
      const body: RecommendationsBody = { success: true, data, videos: data, basedOn };
      if (data.length > 0) {
        const fullTtl = userId ? PERSONAL_RECOMMENDATIONS_TTL : ANONYMOUS_RECOMMENDATIONS_TTL;
        writeEdgeCache(cacheUrl, body, data.length >= limit ? fullTtl : SHORT_RECOMMENDATIONS_TTL, waitUntilOf(c as never));
      }
      if (!userId) c.header("Cache-Control", anonymousRecommendationsCacheControl(data.length, limit));
      logger.debug("[Recommendations] Served recommendations", { videoId: query.videoId, userId, count: data.length, basedOn, source: pool.source });
      c.header("X-Recommendations-Cache", "MISS");
      return c.json(body);
    } catch (error) {
      logger.error("[Recommendations] Failed to build recommendations", { error, videoId: query.videoId });
      return c.json({ success: false, error: "Failed to load recommendations" }, 500, { "Cache-Control": "no-store" });
    }
  }
}
