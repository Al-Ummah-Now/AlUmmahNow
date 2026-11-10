import { Str } from "chanfana";
import { z } from "zod";
import { Playlist, Channel as BusinessChannel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from "../../base";
import { transformVideoToView } from "../../lib/transformations";
import { toPlaylistResponse, canViewPlaylist, canViewVideo, PlaylistType, VideoType } from "../../lib/playlists";
import { resolvePlaylistCovers, type PlaylistCover } from "../../lib/playlistCovers";
import { logger } from "../../lib/logger";

// Upper bound on videos resolved for a single playlist page
const MAX_EXPANDED_VIDEOS = 200;

export class PlaylistFetch extends OptionalAuthRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Get a single playlist by id",
        request: {
            params: z.object({
                id: Str({ description: "Playlist id" }),
            }),
            query: z.object({
                includeVideos: z.enum(["true", "false"]).optional()
                    .describe("When 'true', include `videoItems`: the playlist's viewable videos in playlist order"),
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
        const request = await this.getValidatedData<typeof this.schema>();
        const { id } = request.params;
        const includeVideos = request.query?.includeVideos === "true";
        const userId = this.getUserId(c);

        const repository = new R2Repository<PlaylistType>(c.env.playlists);
        const playlist = await repository.getObject(id);

        // Deleted, hidden and other users' private playlists all look "not found"
        if (!playlist || !canViewPlaylist(playlist, userId)) {
            return c.json({ success: false, error: "Playlist not found" }, 404);
        }

        const response: ReturnType<typeof toPlaylistResponse> & {
            channelName?: string;
            cover?: PlaylistCover;
            videoItems?: ReturnType<typeof transformVideoToView>[];
        } = toPlaylistResponse(playlist);

        if (playlist.channelId) {
            try {
                const channelRepo = new R2Repository<z.infer<typeof BusinessChannel>>(c.env.channels);
                const channel = await channelRepo.getObject(playlist.channelId);
                response.channelName = channel?.name || "";
            } catch (error) {
                logger.warn("[PlaylistFetch] Failed to load channel", {
                    playlistId: id,
                    channelId: playlist.channelId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        if (includeVideos) {
            const videoRepo = new R2Repository<VideoType>(c.env.videos);
            const ids = (playlist.videos || []).slice(0, MAX_EXPANDED_VIDEOS);
            const videos = await Promise.all(ids.map((videoId) => videoRepo.getObject(videoId)));
            response.videoItems = videos
                .filter((video): video is VideoType => !!video && canViewVideo(video, userId))
                .map((video) => transformVideoToView(video));

            logger.debug("[PlaylistFetch] Expanded playlist videos", {
                playlistId: id,
                requested: ids.length,
                returned: response.videoItems.length,
            });

            // The expanded list is already filtered for this viewer
            const first = playlist.thumbnailUrl ? undefined : response.videoItems.find((video) => video.thumbnailUrl);
            if (first?.thumbnailUrl) response.cover = { videoId: first.id, thumbnailUrl: first.thumbnailUrl };
        } else {
            const cover = (await resolvePlaylistCovers(c.env, [playlist], userId)).get(id);
            if (cover) response.cover = cover;
        }

        return response;
    }
}
