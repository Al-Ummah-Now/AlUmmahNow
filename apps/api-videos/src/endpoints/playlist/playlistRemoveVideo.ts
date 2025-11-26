import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Playlist as BusinessPlaylist, ResponseError } from "../../lib/types";
import { PlaylistView } from "../../lib/model/view";
import { transformPlaylistToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";

export class PlaylistRemoveVideo extends AuthenticatedRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Remove a video from a playlist",
        request: {
            params: z.object({
                id: Str({ description: "Playlist ID" }),
                videoId: Str({ description: "Video ID to remove from playlist" }),
            }),
            headers: z.object({
                channelId: Str({ description: "Channel ID" }),
                userId: Str({ description: "User ID" }),
            }),
        },
        responses: {
            "200": {
                description: "Video successfully removed from playlist",
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
                description: "Playlist not found or video not in playlist",
                content: {
                    "application/json": {
                        schema: ResponseError,
                    },
                },
            },
            "400": {
                description: "Bad request - invalid input data",
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
        const { id, videoId } = request.params;
        const { channelId } = request.headers;
        const userId = this.getUserId(c);

        // Get existing playlist
        const bucket = c.env.playlists;
        type PlaylistType = z.infer<typeof BusinessPlaylist>;
        const repository = new R2Repository<PlaylistType>(bucket);
        
        const playlist = await repository.getObject(id);
        if (!playlist) {
            return c.json({
                success: false,
                error: "Playlist not found",
            }, 404);
        }

        // Verify ownership
        if (playlist.channelId !== channelId) {
            return c.json({
                success: false,
                error: "Unauthorized - you can only modify your own playlists",
            }, 403);
        }

        // Check if video is in playlist
        if (!playlist.videos.includes(videoId)) {
            return c.json({
                success: false,
                error: "Video is not in this playlist",
            }, 404);
        }

        // Remove video from playlist
        const updatedPlaylist = {
            ...playlist,
            videos: playlist.videos.filter(vid => vid !== videoId),
            dateModified: new Date().toISOString(),
        };

        // Save updated playlist
        await repository.putObject(id, updatedPlaylist);

        // Send queue message for playlist remove
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.PlaylistRemove, {
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