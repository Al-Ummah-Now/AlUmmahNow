/**
 * Clear Watch History
 * DELETE /api/watch-history
 * Removes all watch history entries for the authenticated user
 */

import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { Context } from "hono";
import R2Repository from "../../lib/r2Repo";
import { addAuthToSchema } from "../../lib/openapi-auth";
import type { WatchHistoryEntry } from "@al-ummah/shared-types";

const ClearResponseSchema = z.object({
  deleted: z.number().describe("Number of entries deleted"),
  message: z.string(),
});

export class ClearWatchHistory extends OpenAPIRoute {
  schema = addAuthToSchema(
    {
      tags: ["Watch History"],
      summary: "Clear all watch history",
      description:
        "Removes all watch history entries for the authenticated user.",
      responses: {
        "200": {
          description: "Watch history cleared successfully",
          content: {
            "application/json": {
              schema: ClearResponseSchema,
            },
          },
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
    const { userId, channelId } = request.headers;

    const auth = c.get("auth");
    const effectiveUserId = userId || auth?.userId;

    if (!effectiveUserId) {
      return c.json({ error: "Authentication required" }, 401);
    }

    try {
      const watchHistoryRepo = new R2Repository<WatchHistoryEntry>(
        c.env.watch_history
      );

      // List all watch history entries
      const allEntriesResponse = await watchHistoryRepo.listObjects(1000);

      // Filter entries for this user
      const userEntries = allEntriesResponse.items.filter(
        (entry) => entry.userId === effectiveUserId
      );

      // Delete all user's entries
      const deletePromises = userEntries.map((entry) =>
        watchHistoryRepo.deleteObject(entry.id)
      );

      await Promise.all(deletePromises);

      return c.json(
        {
          deleted: userEntries.length,
          message: `Successfully cleared ${userEntries.length} watch history ${
            userEntries.length === 1 ? "entry" : "entries"
          }`,
        },
        200
      );
    } catch (error) {
      console.error("Error clearing watch history:", error);
      return c.json(
        {
          error: "Failed to clear watch history",
          details: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  }
}
