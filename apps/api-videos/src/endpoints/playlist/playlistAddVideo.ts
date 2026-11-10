import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Playlist as BusinessPlaylist, Video as BusinessVideo, ResponseError } from "../../lib/types";
import { PlaylistView } from "../../lib/model/view";
import { transformPlaylistToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";
import { canManagePlaylist } from "../../lib/channelAccess";
import { persistAutoOrder } from "../../lib/playlistOrder";

export class PlaylistAddVideo extends AuthenticatedRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Add a video to a playlist",
        request: {
            params: z.object({
                id: Str({ description: "Playlist ID" }),
            }),
            headers: z.object({
                channelId: Str({ description: "Channel ID" }),
            }),
            body: {
                content: {
                    "application/json": {
                        schema: z.object({
                            videoId: Str({ description: "Video ID to add to playlist" }),
                        }),
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Video successfully added to playlist",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: Bool(),
                            result: z.object({
                                playlist: PlaylistView,
                            }),
                        }),
                    },
                },
            },
            "404": {
                description: "Playlist or video not found",
                content: {
                    "application/json": {
                        schema: ResponseError,
                    },
                },
            },
            "400": {
                description: "Bad request - video already in playlist or invalid data",
                content: {
                    "application/json": {
                        schema: ResponseError,
                    },
                },
            },
            "500": {
                description: "Internal server error",
                content: {
                    "application/json": {
                        schema: ResponseError,
                    },
                },
            },
        },
    };

    async handle(c: AppContext) {
        // Get validated data
        const request = await this.getValidatedData<typeof this.schema>();

        // Retrieve the validated parameters
        const { id } = request.params;
        const { channelId } = request.headers;
        const userId = this.getUserId(c);
        const { videoId } = request.body;

        // Get existing playlist
        const playlistsBucket = c.env.playlists;
        type PlaylistType = z.infer<typeof BusinessPlaylist>;
        const playlistRepository = new R2Repository<PlaylistType>(playlistsBucket);
        
        const playlist = await playlistRepository.getObject(id);
        if (!playlist) {
            return c.json({
                success: false,
                error: "Playlist not found",
            }, 404);
        }

        // Its owner, or a channel role that manages playlists (the channelId
        // header is optional, so it cannot be the check on its own)
        if (!(await canManagePlaylist(c.env as never, playlist, userId))) {
            return c.json({
                success: false,
                error: "Unauthorized - you cannot modify this playlist",
            }, 403);
        }

        // Verify video exists
        const videosBucket = c.env.videos;
        type VideoType = z.infer<typeof BusinessVideo>;
        const videoRepository = new R2Repository<VideoType>(videosBucket);
        
        const video = await videoRepository.getObject(videoId);
        if (!video) {
            return c.json({
                success: false,
                error: "Video not found",
            }, 404);
        }

        // Add on the fresh playlist with a conditional write (SCALABILITY-AUDIT
        // AV-19): adding several videos at once keeps all of them
        const { data: updatedPlaylist, rejected } = await playlistRepository.updateObjectOrReject<{ status: 400 | 403; error: string }>(id, (fresh) => {
            // The playlist changed hands meanwhile: check again on the next request
            if (fresh.userId !== playlist.userId || fresh.channelId !== playlist.channelId) return { reject: { status: 403, error: "Unauthorized - you can only modify your own playlists" } };
            const videos = fresh.videos || [];
            if (videos.includes(videoId)) return { reject: { status: 400, error: "Video is already in this playlist" } };
            // Manual order: at the end. The add date feeds the "date added" order.
            const now = new Date().toISOString();
            fresh.videos = [...videos, videoId];
            fresh.videoAddedAt = { ...(fresh.videoAddedAt ?? {}), [videoId]: now };
            fresh.dateModified = now;
            return true;
        });
        if (!updatedPlaylist) {
            return c.json({ success: false, error: "Playlist not found" }, 404);
        }
        if (rejected) {
            return c.json({ success: false, error: rejected.error }, rejected.status);
        }
        // An automatic order places it (no-op for manual playlists)
        const ordered = await persistAutoOrder(c.env as never, id);
        if (ordered) updatedPlaylist.videos = ordered;

        // Send queue message for playlist add
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.PlaylistAdd, {
            playlistId: id,
            videoId: videoId,
            userId: userId,
            channelId: channelId,
            timestamp: new Date().toISOString(),
        });

        // Transform to view model for response
        const playlistView = transformPlaylistToView(updatedPlaylist);

        return {
            success: true,
            result: {
                playlist: playlistView,
            },
        };
    }
}