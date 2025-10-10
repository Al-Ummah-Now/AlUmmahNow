import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import { Playlist, ResponseError } from "../../lib/types";

export class PlaylistDelete extends OpenAPIRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Delete a Playlist",
        request: {
            params: z.object({
                id: Str({ description: "Playlist ID" }),
            }),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
				userId: Str({ description: "User ID" }),
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

    async handle(c) {
        // Get validated data
        const request = await this.getValidatedData<typeof this.schema>();

        // Retrieve the validated playlist ID
        const { id } = request.params;
		const { channelId, userId } = request.headers;

        // Fetch the playlist first to check ownership and privacy
        const bucket = env.playlists;
        type PlaylistType = z.infer<typeof Playlist>;
        const repository = new R2Repository<PlaylistType>(bucket);
        const playlist = await repository.getObject(id);

        if (!playlist) {
            return c.json({
                success: false,
                error: "Playlist not found",
            }, 404);
        }

        // Check privacy permissions and ownership
        if (playlist.isPublic === false && (!userId || playlist.userId !== userId)) {
            return c.json({
                success: false,
                error: "Playlist not found", // Don't reveal that private playlist exists
            }, 404);
        }

        // Only allow deletion by the owner
        if (playlist.userId !== userId) {
            return c.json({
                success: false,
                error: "Unauthorized",
            }, 403);
        }

        // Delete the playlist from the R2 bucket
        await repository.deleteObject(id);

        // Return the confirmation of deletion
        return c.json({
            success: true,
        });
    }
}
