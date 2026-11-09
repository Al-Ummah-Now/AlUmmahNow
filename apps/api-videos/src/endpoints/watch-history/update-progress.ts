/**
 * Update Watch Progress
 * POST /api/watch-history/:videoId/progress
 * Updates the playback progress for a video
 */

import { AuthenticatedRoute, AppContext } from "../../base";
import { Str } from "chanfana";
import { z } from "zod";
import R2Repository from "../../lib/r2Repo";
import { addAuthToSchema } from "../../lib/openapi-auth";
import type {
  WatchHistoryEntry,
  WatchProgressUpdate,
  WatchHistoryEvent
} from "@al-ummah/shared-types";
import { logger } from '../../lib/logger';
import { isWatchHistoryPaused, percentageOf, queueWatchHistoryEvent } from "../../lib/watch-history";

// Path parameter schema
const ProgressParams = z.object({
  videoId: Str({ description: "ID of the video" }),
});

// Request body schema
const ProgressUpdateSchema = z.object({
  progress: z.number().min(0).describe("Current playback position in seconds"),
  duration: z.number().min(0).describe("Total video duration in seconds"),
});

// Response schema
const ProgressResponseSchema = z.object({
  videoId: z.string(),
  progress: z.number(),
  duration: z.number(),
  percentageWatched: z.number(),
  completed: z.boolean(),
  timestamp: z.string(),
});

export class UpdateWatchProgress extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ["Watch History"],
      summary: "Update watch progress for a video",
      description:
        "Updates the current playback position for a video. Should be called periodically (every 10 seconds) during video playback.",
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        params: ProgressParams,
        body: {
          content: {
            "application/json": {
              schema: ProgressUpdateSchema,
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Progress updated successfully",
          content: {
            "application/json": {
              schema: ProgressResponseSchema,
            },
          },
        },
        "400": {
          description: "Invalid request data",
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

    // Use the validated body: getValidatedData() already consumed the request
    // stream, so c.req.json() threw "Body has already been used" (500)
    const body = request.body as WatchProgressUpdate;
    const { progress, duration } = body;

    try {
      if (await isWatchHistoryPaused(c.env.profiles, userId)) {
        return c.json({ paused: true, videoId }, 200);
      }

      const watchHistoryRepo = new R2Repository<WatchHistoryEntry>(
        c.env.watch_history
      );

      // Generate entry ID
      const entryId = `${userId}:${videoId}`;

      // Check if watch history entry exists
      const existingEntry = await watchHistoryRepo.getObject(entryId);
      if (!existingEntry) {
        // Nothing to update yet: the client records the first watch instead
        return c.json({ videoId, recorded: false }, 200);
      }

      // Calculate progress metrics
      const now = new Date().toISOString();
      const percentageWatched = percentageOf(progress, duration);
      const completed = percentageWatched >= 95;

      // Update the fresh entry with a conditional write (SCALABILITY-AUDIT
      // AV-7): beacons from other tabs and watch-state sync are not overwritten
      const updatedEntry = await watchHistoryRepo.updateObject(entryId, (entry) => {
        entry.progress = progress;
        entry.percentageWatched = percentageWatched;
        entry.completed = completed || entry.completed;
        entry.lastWatchedAt = now;
        entry.videoDuration = duration; // Update in case duration changed
        // Watch-state sync (9.9): web writes take part in last-writer-wins at server time
        entry.stateUpdatedAt = now;
        delete entry.stateDeviceId;
      });
      if (!updatedEntry) {
        return c.json({ error: "Watch history entry not found. Create one first by recording a watch." }, 404);
      }

      // Queue progress event
      const event: WatchHistoryEvent = {
        type: completed ? "watch_completed" : "watch_progress",
        userId: userId,
        videoId,
        progress,
        duration,
        timestamp: now,
      };

      await queueWatchHistoryEvent(c.env.queue, event);

      return c.json(
        {
          videoId,
          progress,
          duration,
          percentageWatched,
          completed,
          timestamp: now,
        },
        200
      );
    } catch (error) {
      logger.error("Error updating watch progress:", error);
      return c.json(
        {
          error: "Failed to update watch progress",
          details: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  }
}
