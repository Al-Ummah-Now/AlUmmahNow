import { Str } from "chanfana";
import { z } from "zod";
import { Playlist, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from "../../base";

export class PlaylistFetch extends OptionalAuthRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Get a single playlist by id",
        request: {
            params: z.object({
                id: Str({ description: "Playlist id" }),
            }),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
        },
        responses: {
            "200": {
                description: "Returns a single playlist if found",
                content: {
                    "application/json": {
                        schema: Playlist,
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

    async handle(c: AppContext) {
        // Get validated data
        const request = await this.getValidatedData<typeof this.schema>();

        // Retrieve the validated slug
        const { id } = request.params;
		const { channelId } = request.headers;
        const userId = this.getUserId(c);

        // Implement your own object fetch here
        const bucket = c.env.playlists;
        type PlaylistType = z.infer<typeof Playlist>;
        const repository = new R2Repository<PlaylistType>(bucket);
        let playlist = await repository.getObject(id);

        if (!playlist) {
            return c.json({ success: false, error: "Playlist not found" }, 404);
        }

        // Check if playlist is deleted (soft delete)
        if (playlist.isDeleted) {
            return c.json({ success: false, error: "Playlist not found" }, 404);
        }

        // Check if playlist is hidden (moderation) - blocks everyone
        if (playlist.isHidden) {
            return c.json({ success: false, error: "Playlist not found" }, 404);
        }

        // Check privacy permissions
        if (playlist.isPublic === false && (!userId || playlist.userId !== userId)) {
            return c.json({ success: false, error: "Playlist not found" }, 404); // Don't reveal that private playlist exists
        }

        return playlist;
    }
}
