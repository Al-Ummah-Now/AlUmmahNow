/**
 * Record Watch History
 * POST /api/watch-history
 * Records a video view in the user's watch history
 */

import { z } from "zod";
import R2Repository from "../../lib/r2Repo";
import { addAuthToSchema } from "../../lib/openapi-auth";
import type {
  WatchHistoryEntry,
  RecordWatchRequest,
  WatchHistoryEvent
} from "@al-ummah/shared-types";
import { logger } from '../../lib/logger';
import { AuthenticatedRoute, AppContext } from "../../base";
import { isWatchHistoryPaused, percentageOf, queueWatchHistoryEvent, resolveVideoChannelName, UNKNOWN_CHANNEL_NAME } from "../../lib/watch-history";

// Request schema
const RecordWatchRequestSchema = z.object({
  videoId: z.string().min(1).describe("ID of the video being watched"),
  progress: z.number().min(0).optional().describe("Initial playback progress in seconds"),
  duration: z.number().min(0).describe("Total video duration in seconds"),
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

export class RecordWatchHistory extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ["Watch History"],
      summary: "Record a video view in watch history",
      description:
        "Records a video view for the authenticated user. Creates a new entry or updates existing watch history for this video.",
      request: {
        headers: z.object({
          channelId: z.string().optional().nullable(),
        }),
        body: {
          content: {
            "application/json": {
              schema: RecordWatchRequestSchema,
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Watch history entry created or updated successfully",
          content: {
            "application/json": {
              schema: WatchHistoryEntrySchema,
            },
          },
        },
        "400": {
          description: "Invalid request data",
        },
        "401": {
          description: "Unauthorized - Authentication required",
        },
        "404": {
          description: "Video not found",
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

    const effectiveUserId = this.getUserId(c);

    // getValidatedData() already consumed the request body; reading it again
    // with c.req.json() threw "Body has already been used" (500 on every call)
    const body = request.body as RecordWatchRequest;
    const { videoId, progress = 0, duration } = body;

    try {
      // Paused history: store nothing, queue nothing (existing entries are kept)
      if (await isWatchHistoryPaused(c.env.profiles, effectiveUserId)) {
        return c.json({ paused: true, videoId }, 200);
      }

      // Initialize repositories
      const videoRepo = new R2Repository(c.env.videos);
      const watchHistoryRepo = new R2Repository<WatchHistoryEntry>(
        c.env.watch_history
      );

      // Fetch video details
      const video = await videoRepo.getObject(videoId) as any;
      if (!video) {
        return c.json({ error: "Video not found" }, 404);
      }

      // Generate watch history entry ID (effectiveUserId:videoId)
      const entryId = `${effectiveUserId}:${videoId}`;

      // Check if watch history entry already exists
      const existingEntry = await watchHistoryRepo.getObject(entryId);

      const now = new Date().toISOString();
      const percentageWatched = percentageOf(progress, duration);
      const completed = percentageWatched >= 95;

      let watchEntry: WatchHistoryEntry;

      if (existingEntry) {
        // Update existing entry
        watchEntry = {
          ...existingEntry,
          // Entries recorded before #294 have no channel name
          ...(existingEntry.channelName && existingEntry.channelName !== UNKNOWN_CHANNEL_NAME
            ? {}
            : { channelName: await resolveVideoChannelName(c.env.channels, video) }),
          lastWatchedAt: now,
          watchCount: existingEntry.watchCount + 1,
          progress,
          percentageWatched,
          completed: completed || existingEntry.completed,
          videoDuration: duration, // Update in case duration changed
          // Watch-state sync (9.9): web writes take part in last-writer-wins at server time
          stateUpdatedAt: now,
        };
        delete watchEntry.stateDeviceId;
      } else {
        // Create new entry
        watchEntry = {
          id: entryId,
          userId: effectiveUserId,
          videoId,
          videoTitle: video.title || "Untitled",
          videoThumbnail: video.thumbnailUrl || video.thumbnail,
          videoDuration: duration,
          channelId: video.channelId || "",
          // Channel uploads carry only channelId; legacy imports carry `channel`
          channelName: await resolveVideoChannelName(c.env.channels, video),
          firstWatchedAt: now,
          lastWatchedAt: now,
          watchCount: 1,
          progress,
          completed,
          percentageWatched,
          stateUpdatedAt: now,
        };
      }

      // Save watch history entry
      await watchHistoryRepo.putObject(entryId, watchEntry);

      // Queue analytics event
      const event: WatchHistoryEvent = {
        type: "watch_started",
        userId: effectiveUserId,
        videoId,
        progress,
        duration,
        timestamp: now,
      };

      await queueWatchHistoryEvent(c.env.queue, event);

      return c.json(watchEntry, 201);
    } catch (error) {
      logger.error("Error recording watch history:", error);
      return c.json(
        {
          error: "Failed to record watch history",
          details: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  }
}
