import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Playlist as BusinessPlaylist, ResponseError } from "../../lib/types";
import { PlaylistUpdateInput } from "../../lib/model/input";
import { PlaylistView } from "../../lib/model/view";
import { transformPlaylistToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";
import { isSameVideoSet } from "../../lib/playlists";

export class PlaylistUpdate extends AuthenticatedRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Update a playlist",
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
                        schema: PlaylistUpdateInput,
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

    async handle(c: AppContext) {
        // Get validated data
        const request = await this.getValidatedData<typeof this.schema>();

        // Retrieve the validated parameters
        const { id } = request.params;
        const { channelId } = request.headers;
        const userId = this.getUserId(c);
        const updateData = request.body;

        // Get existing playlist
        const bucket = c.env.playlists;
        type PlaylistType = z.infer<typeof BusinessPlaylist>;
        const repository = new R2Repository<PlaylistType>(bucket);
        
        const existingPlaylist = await repository.getObject(id);
        if (!existingPlaylist) {
            return c.json({
                success: false,
                error: "Playlist not found",
            }, 404);
        }

        // Verify ownership by user (the channelId header is optional, so it
        // cannot be the ownership check on its own)
        if (existingPlaylist.userId !== userId) {
            return c.json({
                success: false,
                error: "Unauthorized - you can only update your own playlists",
            }, 403);
        }

        // Checked and applied on the fresh playlist with a conditional write
        // (SCALABILITY-AUDIT AV-19): a rename during an add no longer reverts it
        const { data: updatedPlaylist, rejected } = await repository.updateObjectOrReject<{ status: 400 | 403; error: string }>(id, (fresh) => {
            if (fresh.userId !== userId) return { reject: { status: 403, error: "Unauthorized - you can only update your own playlists" } };
            // Reordering: the new order must be a permutation of the current videos
            if (updateData.videos && !isSameVideoSet(fresh.videos || [], updateData.videos)) {
                return { reject: { status: 400, error: "videos must contain exactly the playlist's current video IDs (use the add/remove endpoints to change membership)" } };
            }
            Object.assign(fresh, updateData, { dateModified: new Date().toISOString() });
            return true;
        });
        if (!updatedPlaylist) {
            return c.json({ success: false, error: "Playlist not found" }, 404);
        }
        if (rejected) {
            return c.json({ success: false, error: rejected.error }, rejected.status);
        }

        // Send queue message for playlist update
        const queue = new Queue(c.env.queue);
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