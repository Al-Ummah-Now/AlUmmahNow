import { Num, Str } from "chanfana";
import { z } from "zod";
import type { SearchDb, SearchQuery } from "@al-ummah/shared-types";
import { OptionalAuthRoute, AppContext } from "../../base";
import { logger } from "../../lib/logger";
import { SEARCH_MAX_LIMIT, searchIndex } from "../../lib/search/query";
import { attachSearchPlaylistCovers } from "../../lib/search/playlistCovers";

const ErrorSchema = z.object({ success: z.boolean(), error: z.string(), message: z.string().optional() });

const ChannelInfoSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  avatarUrl: z.string().optional(),
  isVerified: z.boolean(),
}).optional();

const ResultSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("video"), id: z.string(), score: z.number(), video: z.object({ id: z.string(), title: z.string() }).passthrough(), channel: ChannelInfoSchema }),
  z.object({ type: z.literal("channel"), id: z.string(), score: z.number(), channel: z.object({ id: z.string(), name: z.string() }).passthrough() }),
  z.object({ type: z.literal("playlist"), id: z.string(), score: z.number(), playlist: z.object({ id: z.string(), name: z.string() }).passthrough(), channel: ChannelInfoSchema }),
  z.object({ type: z.literal("post"), id: z.string(), score: z.number(), post: z.object({ id: z.string(), content: z.string() }).passthrough(), channel: ChannelInfoSchema }),
]);

export const SearchQuerySchema = z.object({
  q: Str({ description: "Search text (Arabic and English; diacritics, alef/hamza forms, taa marbuta and digits are normalised)" }).max(200).optional(),
  type: z.enum(["video", "channel", "playlist", "post"]).optional().describe("Restrict to one result type (default: all types)"),
  duration: z.enum(["short", "medium", "long"]).optional().describe("Videos only: short < 4 min, medium 4-20 min, long > 20 min"),
  format: z.enum(["short", "video"]).optional().describe("Videos only: Shorts (≤ 3 min and vertical or square, or chosen by the uploader) or long-form videos"),
  date: z.enum(["hour", "today", "week", "month", "year"]).optional().describe("Published within the period"),
  language: Str({ description: "Content language code, e.g. en or ar" }).regex(/^[a-z]{2,3}$/).optional(),
  category: Str({ description: "Video/channel category value (VideoCategory, e.g. quran_tafsir)" }).regex(/^[a-z0-9_]{1,40}$/).optional(),
  verified: z.enum(["true", "false", "1", "0"]).optional().describe("Only verified channels and their content"),
  channelId: Str({ description: "Search within one channel" }).max(100).optional(),
  sort: z.enum(["relevance", "date", "popular"]).optional().describe("Default relevance (newest first when q is empty)"),
  cursor: Str({ description: "nextCursor from the previous page" }).max(20).optional(),
  limit: Num({ description: `Results per page (1-${SEARCH_MAX_LIMIT})`, default: 20 }).optional(),
});

export function toSearchQuery(query: z.infer<typeof SearchQuerySchema>): SearchQuery {
  return {
    q: query.q?.trim() || undefined,
    type: query.type,
    duration: query.duration,
    format: query.format,
    date: query.date,
    language: query.language,
    category: query.category,
    verified: query.verified === "true" || query.verified === "1",
    channelId: query.channelId?.trim() || undefined,
    sort: query.sort,
    cursor: query.cursor,
    limit: query.limit,
  };
}

/**
 * GET /api/search
 * Ranked search over the D1 full-text index (Story 29.8).
 */
export class SearchGet extends OptionalAuthRoute {
  schema = {
    tags: ["Search"],
    summary: "Search (v2)",
    description: "🔓 Public. Ranked search across videos, channels, playlists and community posts using the search index. Filters: type, duration, format (short | video), date, language, category, verified, channelId (search within a channel). Without `q`, returns the newest items matching the filters. When no result contains every word, results containing any word are returned with `relaxed: true`.",
    request: { query: SearchQuerySchema },
    responses: {
      "200": {
        description: "Search results",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              query: z.string(),
              type: z.string(),
              results: z.array(ResultSchema),
              nextCursor: z.string().nullable(),
              hasMore: z.boolean(),
              relaxed: z.boolean(),
              searchTime: z.number(),
            }),
          },
        },
      },
      "400": { description: "No query or filter given", content: { "application/json": { schema: ErrorSchema } } },
      "503": { description: "Search index not configured", content: { "application/json": { schema: ErrorSchema } } },
    },
  };

  async handle(c: AppContext) {
    const started = Date.now();
    const { query } = await this.getValidatedData<typeof this.schema>();
    const search = toSearchQuery(query);
    const db = c.env.SEARCH_DB as SearchDb | undefined;

    if (!db) {
      logger.error("[Search] SEARCH_DB binding missing");
      return c.json({ success: false, error: "search_unavailable", message: "Search index is not configured" }, 503);
    }
    const hasFilter = !!(search.type || search.duration || search.format || search.date || search.language || search.category || search.verified || search.channelId);
    if (!search.q && !hasFilter) {
      return c.json({ success: false, error: "query_required", message: "Provide q or at least one filter" }, 400);
    }

    try {
      const result = await searchIndex(db, search);
      await attachSearchPlaylistCovers(c.env, result.results);
      const searchTime = Date.now() - started;
      logger.info("[Search] Served search", {
        q: search.q,
        type: search.type ?? "all",
        filters: { duration: search.duration, format: search.format, date: search.date, language: search.language, category: search.category, verified: search.verified, channelId: search.channelId },
        count: result.results.length,
        relaxed: result.relaxed,
        searchTime,
      });
      c.header("Cache-Control", "public, max-age=30");
      return c.json({
        success: true,
        query: search.q ?? "",
        type: search.type ?? "all",
        ...result,
        searchTime,
      });
    } catch (error) {
      logger.error("[Search] Query failed", { error: error instanceof Error ? error.message : String(error), q: search.q });
      return c.json({ success: false, error: "search_failed", message: "Search failed" }, 500);
    }
  }
}
