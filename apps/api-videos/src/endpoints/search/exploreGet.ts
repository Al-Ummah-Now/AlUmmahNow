import { Str } from "chanfana";
import { z } from "zod";
import type { SearchDb } from "@al-ummah/shared-types";
import { OptionalAuthRoute, AppContext } from "../../base";
import { logger } from "../../lib/logger";
import { buildExplore } from "../../lib/search/explore";

const ErrorSchema = z.object({ success: z.boolean(), error: z.string(), message: z.string().optional() });

/**
 * GET /api/explore
 * Category grid counts, newest channels and active seasonal rails (Story 29.7).
 * Trending and live-now come from /api/trending and /api/live-streams.
 */
export class ExploreGet extends OptionalAuthRoute {
  schema = {
    tags: ["Search"],
    summary: "Explore page data",
    description: "🔓 Public. Returns the video categories that have at least one public, ready video (optionally in one language) with their counts; empty categories are left out, the newest public channels, and seasonal rails that are active now. Seasonal rails are configured in the global_settings bucket at `explore/seasonal.json` (array of `{ id, title: {en, ar}, subtitle?, startsAt, endsAt, category?, query?, limit?, enabled? }`).",
    request: {
      query: z.object({
        language: Str({ description: "Content language code for category counts and seasonal rails" }).regex(/^[a-z]{2,3}$/).optional(),
      }),
    },
    responses: {
      "200": {
        description: "Explore data",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              categories: z.array(z.object({ value: z.string(), label: z.object({ en: z.string(), ar: z.string() }), count: z.number() })),
              newChannels: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
              seasonal: z.array(z.object({ id: z.string(), title: z.object({ en: z.string(), ar: z.string() }), endsAt: z.string(), videos: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough()),
            }),
          },
        },
      },
      "503": { description: "Search index not configured", content: { "application/json": { schema: ErrorSchema } } },
    },
  };

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const db = c.env.SEARCH_DB as SearchDb | undefined;
    if (!db) {
      logger.error("[Explore] SEARCH_DB binding missing");
      return c.json({ success: false, error: "search_unavailable", message: "Search index is not configured" }, 503);
    }
    try {
      const data = await buildExplore(db, c.env.global_settings, { language: query.language });
      logger.info("[Explore] Served explore data", {
        language: query.language,
        categories: data.categories.length,
        newChannels: data.newChannels.length,
        seasonal: data.seasonal.map(rail => rail.id),
      });
      c.header("Cache-Control", "public, max-age=120");
      return c.json({ success: true, ...data });
    } catch (error) {
      logger.error("[Explore] Failed to build explore data", { error: error instanceof Error ? error.message : String(error) });
      return c.json({ success: false, error: "explore_failed", message: "Failed to load explore data" }, 500);
    }
  }
}
