/**
 * Delete Watch History Entry
 * DELETE /api/watch-history/:videoId
 * Removes a specific video from the user's watch history
 */

import { AuthenticatedRoute, AppContext } from "../../base";
import { Str } from "chanfana";
import { z } from "zod";
import R2Repository from "../../lib/r2Repo";
import { addAuthToSchema } from "../../lib/openapi-auth";
import type { WatchHistoryEntry } from "@al-ummah/shared-types";
import { logger } from '../../lib/logger';

// Path parameter schema
const DeleteWatchHistoryParams = z.object({
  videoId: Str({ description: "ID of the video to remove from watch history" }),
});

export class DeleteWatchHistory extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ["Watch History"],
      summary: "Delete a watch history entry",
      description:
        "Removes a specific video from the authenticated user's watch history.",
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: DeleteWatchHistoryParams,
      },
      responses: {
        "204": {
          description: "Watch history entry deleted successfully",
        },
        "401": {
          description: "Unauthorized - Authentication required",
        },
        "404": {
          description: "Watch history entry not found",
        },
        "500": {
          description: "Internal server error",
        },
      },
    },
    "required"
  );

  async handle(c: AppContext) {
    const request = await this.getValidatedData<typeof this.schema>();
    const { channelId } = request.headers;

    const userId = this.getUserId(c);

    // Get videoId from path params
    const { videoId } = c.req.param();

    if (!videoId) {
      return c.json({ error: "Video ID is required" }, 400);
    }

    try {
      const watchHistoryRepo = new R2Repository<WatchHistoryEntry>(
        c.env.watch_history
      );

      // Generate entry ID (userId:videoId)
      const entryId = `${userId}:${videoId}`;

      // Check if entry exists
      const existingEntry = await watchHistoryRepo.getObject(entryId);
      if (!existingEntry) {
        return c.json({ error: "Watch history entry not found" }, 404);
      }

      // Verify the entry belongs to the authenticated user
      if (existingEntry.userId !== userId) {
        return c.json({ error: "Unauthorized to delete this entry" }, 403);
      }

      // Delete the entry
      await watchHistoryRepo.deleteObject(entryId);

      return c.body(null, 204);
    } catch (error) {
      logger.error("Error deleting watch history:", error);
      return c.json(
        {
          error: "Failed to delete watch history entry",
          details: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  }
}
