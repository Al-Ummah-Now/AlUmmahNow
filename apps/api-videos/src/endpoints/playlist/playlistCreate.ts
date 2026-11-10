import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Playlist as BusinessPlaylist, ResponseError } from "../../lib/types";
import { PlaylistInput } from "../../lib/model/input";
import { PlaylistView } from "../../lib/model/view";
import { transformPlaylistToView, createEntityDefaults } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";
import { PLAYLIST_BULK_MAX, can, playlistSortOf, uniqueVideoIds, type ChannelRole, type PlaylistBulkAddResult } from "@al-ummah/shared-types";
import { uploadIdentity } from "../../lib/channelAccess";
import { PLAYLIST_DESCRIPTION_MAX, PLAYLIST_TITLE_MAX } from "../../lib/playlists";
import { bulkAddVideos, type PlaylistEnv } from "../../lib/playlistBulk";
import { logger } from "../../lib/logger";

export class PlaylistCreate extends AuthenticatedRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Create a new Playlist",
        request: {
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
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
                                add: z.object({
                                    status: z.enum(["done", "queued", "failed"]),
                                    added: z.number(),
                                    alreadyInPlaylist: z.number(),
                                    notInChannel: z.number(),
                                    pending: z.number(),
                                    videosCount: z.number(),
                                    jobId: z.string().optional(),
                                }).optional().describe("What happened to `videos`: added inline, or queued for the background"),
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

        // A channel member creates the playlist for the channel: it belongs to
        // the channel's owner, like their uploads (lib/channelAccess.ts), and
        // needs playlist.manage (channelIdMiddleware checks it too)
        const role = c.get('channelRole') as ChannelRole | null | undefined;
        if (role && role !== 'owner' && !can(role, 'playlist.manage')) {
            return c.json({ success: false, error: "You do not have permission to manage this channel's playlists" }, 403);
        }
        const { ownerId, uploadedBy } = uploadIdentity(c, userId);
        const videoIds = uniqueVideoIds(playlistInput.videos || []);
        if (videoIds.length > PLAYLIST_BULK_MAX) {
            return c.json({ success: false, error: `At most ${PLAYLIST_BULK_MAX} videos can be added at once` }, 400);
        }

        // Create business playlist object (empty: the videos are validated and
        // added below, so a bad id never lands in the playlist)
        const entityDefaults = createEntityDefaults();
        
        const title = (playlistInput.title || '').trim();
        if (!title) {
            return c.json({ success: false, error: "Playlist title is required" }, 400);
        }

        const businessPlaylist = {
            ...entityDefaults,
            title: title.slice(0, PLAYLIST_TITLE_MAX),
            description: playlistInput.description?.slice(0, PLAYLIST_DESCRIPTION_MAX),
            thumbnailUrl: playlistInput.thumbnailUrl,
            userId: ownerId,
            ...(uploadedBy ? { createdBy: uploadedBy } : {}),
            channelId: channelId,
            videos: [] as string[],
            isPublic: playlistInput.isPublic ?? true,
            // The order (default manual); an automatic one sorts the videos as they are added
            ...playlistSortOf(playlistInput),
            videoAddedAt: {} as Record<string, string>,
        };

        // Save the playlist to the R2 bucket (create-only: the id is new)
        const bucket = c.env.playlists;
        type PlaylistType = z.infer<typeof BusinessPlaylist>;
        const repository = new R2Repository<PlaylistType>(bucket);
        await repository.createObject(businessPlaylist.id, businessPlaylist);

        // Send queue message for playlist creation
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.PlaylistCreate, {
            playlistId: businessPlaylist.id,
            userId: userId,
            channelId: channelId,
            timestamp: new Date().toISOString(),
        });

        // The chosen videos, in the chosen order. The playlist exists from here
        // on: an add that fails inline continues in the background job queue
        // (status 'queued'); the answer always says what happened.
        let add: PlaylistBulkAddResult | undefined;
        let stored: PlaylistType = businessPlaylist;
        if (videoIds.length > 0) {
            add = await bulkAddVideos(c.env as unknown as PlaylistEnv, { playlist: businessPlaylist, ids: videoIds, actorId: userId });
            if (add.added > 0) stored = (await repository.getObject(businessPlaylist.id)) ?? businessPlaylist;
            logger.info('[PlaylistCreate] Playlist created with videos', { playlistId: businessPlaylist.id, requested: videoIds.length, ...add });
        }

        // Transform to view model for response
        const playlistView = transformPlaylistToView(stored);

        // Return the new playlist
        return {
            success: true,
            result: {
                playlist: playlistView,
                ...(add ? { add } : {}),
            },
        };
    }
}
