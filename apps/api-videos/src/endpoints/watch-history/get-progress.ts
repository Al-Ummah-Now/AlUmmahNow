/**
 * Get Watch Progress
 * GET /api/watch-history/:videoId/progress
 * Retrieves the current watch progress for a video
 */

import { AuthenticatedRoute, AppContext } from "../../base";
import { Str } from "chanfana";
import { z } from "zod";
import R2Repository from "../../lib/r2Repo";
import { addAuthToSchema } from "../../lib/openapi-auth";
import type { WatchHistoryEntry } from "@al-ummah/shared-types";
import { logger } from '../../lib/logger';

// Path parameter schema
const ProgressParams = z.object({
  videoId: Str({ description: "ID of the video" }),
});

// Response schema
const ProgressResponseSchema = z.object({
  videoId: z.string(),
  progress: z.number().nullable().describe("null when the video has never been watched. Current playback position in seconds"),
  duration: z.number().optional().describe("Total video duration in seconds"),
  percentageWatched: z.number().optional().describe("Percentage of video watched (0-100)"),
  completed: z.boolean().optional().describe("Whether the video has been fully watched"),
  lastWatchedAt: z.string().optional().describe("Timestamp of last watch"),
});

export class GetWatchProgress extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ["Watch History"],
      summary: "Get watch progress for a video",
      description:
        "Retrieves the current playback progress for a video. Used to resume playback from where the user left off.",
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: ProgressParams,
      },
      responses: {
        "200": {
          description: "Progress for the video; progress is null when it has never been watched",
          content: {
            "application/json": {
              schema: ProgressResponseSchema,
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

      // Generate entry ID
      const entryId = `${userId}:${videoId}`;

      // Get watch history entry
      const entry = await watchHistoryRepo.getObject(entryId);
      if (!entry) {
        // Never watched is a normal answer, not a missing resource
        return c.json({ videoId, progress: null }, 200);
      }

      return c.json(
        {
          videoId: entry.videoId,
          progress: entry.progress,
          duration: entry.videoDuration,
          percentageWatched: entry.percentageWatched,
          completed: entry.completed,
          lastWatchedAt: entry.lastWatchedAt,
        },
        200
      );
    } catch (error) {
      logger.error("Error getting watch progress:", error);
      return c.json(
        {
          error: "Failed to retrieve watch progress",
          details: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  }
}
