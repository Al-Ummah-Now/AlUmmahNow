import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Playlist as BusinessPlaylist, ResponseError } from "../../lib/types";
import { PlaylistInput } from "../../lib/model/input";
import { PlaylistView } from "../../lib/model/view";
import { transformPlaylistToView, createEntityDefaults } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";

export class PlaylistCreate extends AuthenticatedRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Create a new Playlist",
        request: {
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
				userId: Str({ description: "User ID" }),
			}),
            body: {
                content: {
                    "application/json": {
                        schema: PlaylistInput,
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Returns the created playlist",
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

        // Retrieve the validated request body
        const playlistInput = request.body;
		const { channelId } = request.headers;
        const userId = this.getUserId(c);

        // Create business playlist object
        const entityDefaults = createEntityDefaults();
        
        const businessPlaylist = {
            ...entityDefaults,
            title: playlistInput.title,
            description: playlistInput.description,
            thumbnailUrl: playlistInput.thumbnailUrl,
            userId: userId,
            channelId: channelId,
            videos: playlistInput.videos || [],
            isPublic: playlistInput.isPublic ?? true,
        };

        // Save the playlist to the R2 bucket
        const bucket = c.env.playlists;
        type PlaylistType = z.infer<typeof BusinessPlaylist>;
        const repository = new R2Repository<PlaylistType>(bucket);
        await repository.putObject(businessPlaylist.id, businessPlaylist);

        // Send queue message for playlist creation
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.PlaylistCreate, {
            playlistId: businessPlaylist.id,
            userId: userId,
            channelId: channelId,
            timestamp: new Date().toISOString(),
        });

        // Transform to view model for response
        const playlistView = transformPlaylistToView(businessPlaylist);

        // Return the new playlist
        return {
            success: true,
            result: {
                playlist: playlistView,
            },
        };
    }
}
