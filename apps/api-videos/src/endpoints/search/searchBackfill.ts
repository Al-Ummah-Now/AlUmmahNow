import { Num, Str } from "chanfana";
import { z } from "zod";
import { SEARCH_ENTITY_TYPES, SEARCH_TABLES, SearchDb, pruneSearchIndex } from "@al-ummah/shared-types";
import { PublicRoute } from "../../base";
import type { AppContext } from "../../base";
import { logger } from "../../lib/logger";
import { BACKFILL_MAX_PAGE, backfillSearchPage } from "../../lib/search/backfill";
import { ownershipStats, runOwnershipPass } from "../../lib/search/ownership";

const ErrorSchema = z.object({ success: z.boolean(), error: z.string(), message: z.string().optional() });

/**
 * POST /internal/search/backfill
 * Index one page of a bucket; call again with `nextCursor` until `done`.
 * Guarded by X-API-Key = INTERNAL_API_KEY (src/index.ts, /internal/*).
 */
export class SearchBackfillPost extends PublicRoute {
  schema = {
    tags: ["Internal"],
    summary: "Search index backfill (internal)",
    description: "🔐 Requires `X-API-Key: <INTERNAL_API_KEY>`. Indexes one page of the R2 bucket for `entity` into the D1 search index and returns `nextCursor` (null when the bucket is done). With `prune=<epoch ms>` (and no other work) deletes rows of `entity` not refreshed since that time, i.e. objects that no longer exist. See apps/api-videos/scripts/search-backfill.sh.",
    request: {
      query: z.object({
        entity: z.enum(["video", "channel", "playlist", "post"]),
        cursor: Str({ description: "nextCursor from the previous call" }).optional(),
        limit: Num({ description: `Objects per call (1-${BACKFILL_MAX_PAGE})`, default: 50 }).optional(),
        prune: Num({ description: "Delete rows of this entity with indexed_at older than this epoch-ms timestamp" }).optional(),
      }),
    },
    responses: {
      "200": {
        description: "Page indexed",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              entity: z.string(),
              scanned: z.number().optional(),
              indexed: z.number().optional(),
              hidden: z.number().optional(),
              removed: z.number().optional(),
              unchanged: z.number().optional(),
              failed: z.number().optional(),
              nextCursor: z.string().nullable().optional(),
              done: z.boolean().optional(),
              pruned: z.boolean().optional(),
            }),
          },
        },
      },
      "401": { description: "Missing or wrong X-API-Key", content: { "application/json": { schema: ErrorSchema } } },
      "503": { description: "SEARCH_DB not bound", content: { "application/json": { schema: ErrorSchema } } },
    },
  };

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const db = c.env.SEARCH_DB as SearchDb | undefined;
    if (!db) return c.json({ success: false, error: "search_unavailable", message: "SEARCH_DB is not bound" }, 503);

    try {
      if (query.prune !== undefined) {
        await pruneSearchIndex(db, query.entity, query.prune);
        logger.info("[SearchBackfill] Pruned stale rows", { entity: query.entity, before: query.prune });
        return c.json({ success: true, entity: query.entity, pruned: true });
      }
      const result = await backfillSearchPage(c.env as never, query.entity, { cursor: query.cursor, limit: query.limit, mode: "force" });
      logger.info("[SearchBackfill] Indexed page", { ...result });
      return c.json({ success: true, ...result });
    } catch (error) {
      logger.error("[SearchBackfill] Backfill failed", { entity: query.entity, error: error instanceof Error ? error.message : String(error) });
      return c.json({ success: false, error: "backfill_failed", message: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
}

/**
 * POST /internal/search/ownership-backfill
 * Advance the ownership index rebuild pass for `entity` by up to `pages` pages.
 * The cursor is kept server-side (search_meta), so call again until `done`;
 * a finished pass prunes rows of deleted objects and marks the index complete,
 * after which owner/channel listings read it instead of scanning R2.
 * Guarded by X-API-Key = INTERNAL_API_KEY (src/index.ts, /internal/*).
 */
export class OwnershipBackfillPost extends PublicRoute {
  schema = {
    tags: ["Internal"],
    summary: "Ownership index backfill (internal)",
    description: "🔐 Requires `X-API-Key: <INTERNAL_API_KEY>`. Advances the full rebuild pass of the ownership index (all videos or channels, including private ones) by up to `pages` pages of 100 objects. Repeat until `done` is true; `complete` reports whether readers now trust the index. The daily cron and on-demand self-heal run the same pass.",
    request: {
      query: z.object({
        entity: z.enum(["video", "channel"]),
        pages: Num({ description: "Pages of 100 objects to process (1-50)", default: 10 }).optional(),
      }),
    },
    responses: {
      "200": {
        description: "Pass advanced",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              kind: z.string(),
              pages: z.number(),
              scanned: z.number(),
              done: z.boolean(),
              complete: z.boolean(),
            }),
          },
        },
      },
      "401": { description: "Missing or wrong X-API-Key", content: { "application/json": { schema: ErrorSchema } } },
      "503": { description: "SEARCH_DB not bound", content: { "application/json": { schema: ErrorSchema } } },
    },
  };

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const db = c.env.SEARCH_DB as SearchDb | undefined;
    if (!db) return c.json({ success: false, error: "search_unavailable", message: "SEARCH_DB is not bound" }, 503);
    const pages = Math.min(Math.max(1, Math.floor(Number(query.pages) || 10)), 50);
    try {
      const result = await runOwnershipPass(c.env as never, query.entity, { maxPages: pages });
      logger.info("[Ownership] Backfill call finished", { ...result });
      return c.json({ success: true, ...result });
    } catch (error) {
      logger.error("[Ownership] Backfill failed", { entity: query.entity, error: error instanceof Error ? error.message : String(error) });
      return c.json({ success: false, error: "backfill_failed", message: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
}

/**
 * GET /internal/search/stats
 * Row counts per index table (internal diagnostics).
 */
export class SearchIndexStats extends PublicRoute {
  schema = {
    tags: ["Internal"],
    summary: "Search index stats (internal)",
    description: "🔐 Requires `X-API-Key: <INTERNAL_API_KEY>`. Rows per entity type (total and searchable) and the reconciliation sweep state.",
    responses: {
      "200": {
        description: "Index stats",
        content: { "application/json": { schema: z.object({ success: z.boolean(), tables: z.record(z.object({ rows: z.number(), searchable: z.number() })) }).passthrough() } },
      },
    },
  };

  async handle(c: AppContext) {
    const db = c.env.SEARCH_DB as SearchDb | undefined;
    if (!db) return c.json({ success: false, error: "search_unavailable", message: "SEARCH_DB is not bound" }, 503);
    const statements = SEARCH_ENTITY_TYPES.map(type => db.prepare(
      `SELECT COUNT(*) AS rows, (SELECT COUNT(*) FROM ${SEARCH_TABLES[type].fts}) AS searchable FROM ${SEARCH_TABLES[type].base}`,
    ));
    statements.push(db.prepare("SELECT key, value, updated_at FROM search_meta"));
    const results = (await db.batch(statements)) as Array<{ results?: Array<Record<string, unknown>> }>;
    const tables: Record<string, { rows: number; searchable: number }> = {};
    SEARCH_ENTITY_TYPES.forEach((type, i) => {
      const row = results[i].results?.[0] ?? {};
      tables[type] = { rows: Number(row.rows) || 0, searchable: Number(row.searchable) || 0 };
    });
    let ownership: Awaited<ReturnType<typeof ownershipStats>> | null = null;
    try {
      ownership = await ownershipStats(db);
    } catch (error) {
      logger.warn("[SearchIndexStats] Ownership stats unavailable", { error: error instanceof Error ? error.message : String(error) });
    }
    return c.json({ success: true, tables, ownership, sweep: results[SEARCH_ENTITY_TYPES.length].results ?? [] });
  }
}
