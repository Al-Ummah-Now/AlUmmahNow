import { Bool, Str } from "chanfana";
import { z } from "zod";
import R2Repository from "../../lib/r2Repo";
import { Playlist, ResponseError } from "../../lib/types";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";
import { canManagePlaylist } from "../../lib/playlistBulk";

export class PlaylistDelete extends AuthenticatedRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Delete a Playlist",
        request: {
            params: z.object({
                id: Str({ description: "Playlist ID" }),
            }),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
			}),
        },
        responses: {
            "200": {
                description: "Returns if the playlist was deleted successfully",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: Bool(),
                        }),
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

        // Retrieve the validated playlist ID
        const { id } = request.params;
		const { channelId } = request.headers;
        const userId = this.getUserId(c);

        // Fetch the playlist first to check ownership and privacy
        const bucket = c.env.playlists;
        type PlaylistType = z.infer<typeof Playlist>;
        const repository = new R2Repository<PlaylistType>(bucket);
        const playlist = await repository.getObject(id);

        if (!playlist) {
            return c.json({
                success: false,
                error: "Playlist not found",
            }, 404);
        }

        // The owner, or a role on the playlist's channel granting playlist.manage
        const allowed = await canManagePlaylist(c.env as never, playlist, userId);
        if (!allowed && playlist.isPublic === false) {
            return c.json({
                success: false,
                error: "Playlist not found", // Don't reveal that private playlist exists
            }, 404);
        }
        if (!allowed) {
            return c.json({
                success: false,
                error: "Unauthorized",
            }, 403);
        }

        // Send queue message for playlist deletion
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.PlaylistDelete, {
            playlistId: id,
            userId: userId,
            channelId: channelId,
            timestamp: new Date().toISOString(),
        });

        // Delete the playlist from the R2 bucket
        await repository.deleteObject(id);

        // Return the confirmation of deletion
        return c.json({
            success: true,
        });
    }
}
