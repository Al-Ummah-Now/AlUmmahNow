import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Playlist as BusinessPlaylist, Video as BusinessVideo, ResponseError } from "../../lib/types";
import { PlaylistView } from "../../lib/model/view";
import { transformPlaylistToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class PlaylistAddVideo extends OpenAPIRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Add a video to a playlist",
        request: {
            params: z.object({
                id: Str({ description: "Playlist ID" }),
            }),
            headers: z.object({
                channelId: Str({ description: "Channel ID" }),
                userId: Str({ description: "User ID" }),
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

    async handle(c) {
        // Get validated data
        const request = await this.getValidatedData<typeof this.schema>();

        // Retrieve the validated parameters
        const { id } = request.params;
        const { channelId, userId } = request.headers;
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

        // Verify ownership
        if (playlist.channelId !== channelId) {
            return c.json({
                success: false,
                error: "Unauthorized - you can only modify your own playlists",
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

        // Check if video is already in playlist
        if (playlist.videos.includes(videoId)) {
            return c.json({
                success: false,
                error: "Video is already in this playlist",
            }, 400);
        }

        // Add video to playlist
        const updatedPlaylist = {
            ...playlist,
            videos: [...playlist.videos, videoId],
            dateModified: new Date().toISOString(),
        };

        // Save updated playlist
        await playlistRepository.putObject(id, updatedPlaylist);

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