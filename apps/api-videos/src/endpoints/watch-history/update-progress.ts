/**
 * Update Watch Progress
 * POST /api/watch-history/:videoId/progress
 * Updates the playback progress for a video
 */

import { kidsVideo } from '../../lib/contentFlags';
import { AuthenticatedRoute, AppContext } from "../../base";
import { Str } from "../../lib/chanfana-params";
import { z } from "zod";
import R2Repository, { ConcurrentUpdateError } from "../../lib/r2Repo";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { TransientStorageError, withStorageRetry } from "@al-ummah/shared-types";
import type {
  WatchHistoryEntry,
  WatchProgressUpdate,
  WatchHistoryEvent
} from "@al-ummah/shared-types";
import { logger } from '../../lib/logger';
import { apiError } from '../../lib/api-error';
import { markErrorLogged } from '../../middleware/logging';
import { isWatchHistoryPaused, percentageOf, queueWatchHistoryEvent } from "../../lib/watch-history";

/** Two more tries, about 100 and 200 ms apart: a beacon must not hold a connection for long. */
const RETRY = { retries: 2, baseDelayMs: 100 };

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

const BusyResponseSchema = z.object({
  success: z.boolean(),
  code: z.string(),
});

/** Busy answers of this isolate: the first and every 20th are logged. */
let busyAnswers = 0;

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
        "503": {
          description: "Not saved: storage is briefly busy (code `busy`). Retry after Retry-After seconds",
          content: {
            "application/json": {
              schema: BusyResponseSchema,
            },
          },
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
      const watchHistoryRepo = new R2Repository<WatchHistoryEntry>(
        c.env.watch_history
      );

      // Generate entry ID
      const entryId = `${userId}:${videoId}`;

      // Read together: this runs every 10 s of playback. R2Repository retries each read (R2 10001 and the like)
      const [paused, existingEntry, kids] = await Promise.all([
        isWatchHistoryPaused(c.env.profiles, userId),
        watchHistoryRepo.getObject(entryId),
        // Made for kids: an entry from before it was marked stays as it is (wiki E20 §5.5)
        kidsVideo(c.env, videoId),
      ]);
      if (paused) return c.json({ paused: true, videoId }, 200);
      // Nothing to update yet: the client records the first watch instead
      if (!existingEntry || kids) return c.json({ videoId, recorded: false }, 200);

      // Calculate progress metrics
      const now = new Date().toISOString();
      const percentageWatched = percentageOf(progress, duration);
      const completed = percentageWatched >= 95;

      // Update the fresh entry with a conditional write (SCALABILITY-AUDIT
      // AV-7): beacons from other tabs and watch-state sync are not overwritten
      const updatedEntry = await withStorageRetry("update", () => watchHistoryRepo.updateObject(entryId, (entry) => {
        entry.progress = progress;
        entry.percentageWatched = percentageWatched;
        entry.completed = completed || entry.completed;
        entry.lastWatchedAt = now;
        entry.videoDuration = duration; // Update in case duration changed
        // Watch-state sync (9.9): web writes take part in last-writer-wins at server time
        entry.stateUpdatedAt = now;
        delete entry.stateDeviceId;
      }), RETRY);
      if (!updatedEntry) {
        return c.json({ error: "Watch history entry not found. Create one first by recording a watch." }, 404);
      }

      // Only completion is queued: the processor does nothing with watch_progress, which
      // was one queue message (3 billed operations) every 10 s of signed-in playback
      if (completed) {
        const event: WatchHistoryEvent = {
          type: "watch_completed",
          userId: userId,
          videoId,
          progress,
          duration,
          timestamp: now,
        };
        await queueWatchHistoryEvent(c.env.queue, event);
      }

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
      // Storage was briefly unavailable, or other tabs kept winning the write: not an error of ours. 503 and
      // Retry-After: the native apps keep the update and send it again, the web player keeps it on the device.
      // Not an error group (X-Error-Expected), and one warning per 20.
      if (error instanceof TransientStorageError || error instanceof ConcurrentUpdateError) {
        if (busyAnswers++ % 20 === 0) logger.warn("[WatchHistory] Progress not saved: storage busy", { code: error instanceof TransientStorageError ? error.code : "contention", answers: busyAnswers });
        markErrorLogged(c);
        return apiError(c, 503, "busy", undefined, { "Retry-After": "5", "X-Error-Expected": "busy" });
      }
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
