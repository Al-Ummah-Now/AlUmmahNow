import { Bool, Str } from "chanfana";
import { z } from "zod";
import { ResponseError } from "../../lib/types";
import { AuthenticatedRoute, AppContext } from "../../base";
import {
    MAX_PLAYLISTS_PER_VIDEO,
    MAX_STATUS_VIDEOS,
    readPlaylistAddStatus,
    requestPlaylistAdds,
    type PlaylistAddEnv,
} from "../../lib/playlistUploadAdds";

const STATUS = z.enum(["pending", "added", "retrying", "failed"]);
const REFUSAL = z.enum(["playlist_not_found", "other_channel", "forbidden", "video_gone"]);

function executionContext(c: AppContext) {
    try {
        return c.executionCtx;
    } catch {
        return undefined;
    }
}

/**
 * POST /api/playlists/upload-adds: queue adds of a new upload to playlists
 * (lib/playlistUploadAdds.ts). Answers at once; the adds run on the queue.
 */
export class PlaylistUploadAddsCreate extends AuthenticatedRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Queue adding a new upload to playlists",
        description: "Called by the upload page once the video record exists. Each add is queued (retried with backoff, flagged for an admin when it keeps failing). A playlist the caller may not change is answered failed with the reason.",
        request: {
            headers: z.object({
                channelId: Str({ description: "Channel the upload belongs to" }),
            }),
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            videoId: Str({ description: "The uploaded video" }),
                            playlistIds: z.array(Str()).min(1).max(MAX_PLAYLISTS_PER_VIDEO),
                            orderKey: Str({ description: "Upload position (batch id + index): keeps the batch's videos in upload order" }),
                        }),
                    },
                },
            },
        },
        responses: {
            "202": {
                description: "Adds queued",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: Bool(),
                            result: z.object({
                                items: z.array(z.object({ playlistId: Str(), status: STATUS, refusal: REFUSAL.optional() })),
                            }),
                        }),
                    },
                },
            },
            "400": { description: "Invalid request", content: { "application/json": { schema: ResponseError } } },
            "403": { description: "The video belongs to another channel", content: { "application/json": { schema: ResponseError } } },
            "404": { description: "Video not found", content: { "application/json": { schema: ResponseError } } },
        },
    };

    async handle(c: AppContext) {
        const request = await this.getValidatedData<typeof this.schema>();
        const userId = this.getUserId(c);
        const result = await requestPlaylistAdds(c.env as unknown as PlaylistAddEnv, {
            videoId: request.body.videoId,
            playlistIds: request.body.playlistIds,
            orderKey: request.body.orderKey,
            channelId: request.headers.channelId,
            userId,
        }, executionContext(c));
        // strictNullChecks is off here, so narrow on the field, not on `ok`
        if ('error' in result) return c.json({ success: false, error: result.error }, result.status);
        return c.json({ success: true, result: { items: result.items } }, 202);
    }
}

/** GET /api/playlists/upload-adds?videoIds=a,b: the caller's adds for these uploads. */
export class PlaylistUploadAddsStatus extends AuthenticatedRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Status of the playlist adds of new uploads",
        request: {
            query: z.object({
                videoIds: Str({ description: `Comma-separated video ids (at most ${MAX_STATUS_VIDEOS})` }),
            }),
        },
        responses: {
            "200": {
                description: "One item per requested add",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: Bool(),
                            result: z.object({
                                items: z.array(z.object({
                                    videoId: Str(),
                                    playlistId: Str(),
                                    status: STATUS,
                                    refusal: REFUSAL.optional(),
                                    attempts: z.number(),
                                })),
                            }),
                        }),
                    },
                },
            },
        },
    };

    async handle(c: AppContext) {
        const request = await this.getValidatedData<typeof this.schema>();
        const userId = this.getUserId(c);
        const videoIds = request.query.videoIds.split(',').map((id) => id.trim()).filter(Boolean);
        const items = await readPlaylistAddStatus(c.env as unknown as PlaylistAddEnv, videoIds, userId);
        return { success: true, result: { items } };
    }
}
