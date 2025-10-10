import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Playlist as BusinessPlaylist, ResponseError } from "../../lib/types";
import { PlaylistUpdateInput } from "../../lib/model/input";
import { PlaylistView } from "../../lib/model/view";
import { transformPlaylistToView } from "../../lib/transformations";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class PlaylistUpdate extends OpenAPIRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Update a playlist",
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
                            title: Str({ required: false, description: "Playlist title" }),
                            description: Str({ required: false, description: "Playlist description" }),
                            thumbnailUrl: Str({ required: false, description: "Playlist thumbnail URL" }),
                            isPublic: z.boolean().optional(),
                        }),
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Returns the updated playlist",
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
                description: "Playlist not found",
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

    async handle(c) {
        // Get validated data
        const request = await this.getValidatedData<typeof this.schema>();

        // Retrieve the validated parameters
        const { id } = request.params;
        const { channelId, userId } = request.headers;
        const updateData = request.body;

        // Get existing playlist
        const bucket = env.playlists;
        type PlaylistType = z.infer<typeof BusinessPlaylist>;
        const repository = new R2Repository<PlaylistType>(bucket);
        
        const existingPlaylist = await repository.getObject(id);
        if (!existingPlaylist) {
            return c.json({
                success: false,
                error: "Playlist not found",
            }, 404);
        }

        // Verify ownership (user must own the playlist via their channel)
        if (existingPlaylist.channelId !== channelId) {
            return c.json({
                success: false,
                error: "Unauthorized - you can only update your own playlists",
            }, 403);
        }

        // Update the playlist with new values
        const updatedPlaylist = {
            ...existingPlaylist,
            ...updateData,
            dateModified: new Date().toISOString(),
        };

        // Save updated playlist
        await repository.putObject(id, updatedPlaylist);

        // Send queue message for playlist update
        const queue = new Queue();
        await queue.send(MessageType.PlaylistEdit, {
            playlistId: id,
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