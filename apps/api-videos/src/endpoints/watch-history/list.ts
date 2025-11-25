/**
 * List Watch History
 * GET /api/watch-history
 * Returns the authenticated user's watch history
 */

import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import R2Repository from "../../lib/r2Repo";
import { addAuthToSchema } from "../../lib/openapi-auth";
import type {
  WatchHistoryEntry,
  WatchHistoryResponse,
  WatchHistoryListRequest
} from "@al-ummah/shared-types";
import { logger } from '../../lib/logger';

// Request query parameters schema
const ListWatchHistoryQuery = z.object({
  limit: z.coerce
    .number()
    .min(1)
    .max(100)
    .default(20)
    .describe("Number of entries to return (default: 20, max: 100)"),
  cursor: z
    .string()
    .optional()
    .describe("Cursor for pagination"),
  completed: z.coerce
    .boolean()
    .optional()
    .describe("Filter by completion status"),
  sort: z
    .enum(["newest", "oldest", "alphabetical"])
    .default("newest")
    .describe("Sort order (default: newest)"),
});

// Response schema
const WatchHistoryEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  videoId: z.string(),
  videoTitle: z.string(),
  videoThumbnail: z.string().optional(),
  videoDuration: z.number(),
  channelId: z.string(),
  channelName: z.string(),
  firstWatchedAt: z.string(),
  lastWatchedAt: z.string(),
  watchCount: z.number(),
  progress: z.number(),
  completed: z.boolean(),
  percentageWatched: z.number(),
});

const WatchHistoryResponseSchema = z.object({
  entries: z.array(WatchHistoryEntrySchema),
  total: z.number(),
  hasMore: z.boolean(),
  cursor: z.string().optional(),
});

export class ListWatchHistory extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ["Watch History"],
      summary: "List user's watch history",
      description:
        "Returns paginated list of videos watched by the authenticated user, sorted by most recent by default.",
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        query: ListWatchHistoryQuery,
      },
      responses: {
        "200": {
          description: "Watch history entries retrieved successfully",
          content: {
            "application/json": {
              schema: WatchHistoryResponseSchema,
            },
          },
        },
        "400": {
          description: "Invalid query parameters",
        },
        "401": {
          description: "Unauthorized - Authentication required",
        },
        "500": {
          description: "Internal server error",
        },
      },
    },
    "required"
  );

  async handle(c: Context) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId } = request.headers;

    const auth = c.get("auth");
    const effectiveUserId = auth?.userId;

    if (!effectiveUserId) {
      return c.json({ error: "Authentication required" }, 401);
    }

    // Parse and validate query parameters
    const query = c.req.query();
    const limit = parseInt(query.limit || "20", 10);
    const cursor = query.cursor;
    const completed = query.completed !== undefined ? query.completed === "true" : undefined;
    const sort = (query.sort || "newest") as "newest" | "oldest" | "alphabetical";

    try {
      const watchHistoryRepo = new R2Repository<WatchHistoryEntry>(
        c.env.watch_history
      );

      // List all watch history entries for this user
      // Entries are stored with key pattern: userId:videoId
      const allEntriesResponse = await watchHistoryRepo.listObjects(1000); // Fetch up to 1000 entries

      // Filter entries for this user only
      let userEntries = allEntriesResponse.items.filter(
        (entry) => entry.userId === effectiveUserId
      );

      // Apply completed filter if specified
      if (completed !== undefined) {
        userEntries = userEntries.filter(
          (entry) => entry.completed === completed
        );
      }

      // Sort entries
      switch (sort) {
        case "newest":
          userEntries.sort(
            (a, b) =>
              new Date(b.lastWatchedAt).getTime() -
              new Date(a.lastWatchedAt).getTime()
          );
          break;
        case "oldest":
          userEntries.sort(
            (a, b) =>
              new Date(a.lastWatchedAt).getTime() -
              new Date(b.lastWatchedAt).getTime()
          );
          break;
        case "alphabetical":
          userEntries.sort((a, b) =>
            a.videoTitle.localeCompare(b.videoTitle)
          );
          break;
      }

      // Apply pagination
      const startIndex = cursor ? parseInt(cursor, 10) : 0;
      const endIndex = startIndex + limit;
      const paginatedEntries = userEntries.slice(startIndex, endIndex);
      const hasMore = endIndex < userEntries.length;
      const nextCursor = hasMore ? String(endIndex) : undefined;

      const response: WatchHistoryResponse = {
        entries: paginatedEntries,
        total: userEntries.length,
        hasMore,
        cursor: nextCursor,
      };

      return c.json(response, 200);
    } catch (error) {
      logger.error("Error listing watch history:", error);
      return c.json(
        {
          error: "Failed to retrieve watch history",
          details: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  }
}
