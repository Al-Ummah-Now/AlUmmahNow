import { Str } from "chanfana";
import { withPlayback } from '../../lib/media/playback';
import { z } from "zod";
import { Playlist, Channel as BusinessChannel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from "../../base";
import { transformVideoToView } from "../../lib/transformations";
import { toPlaylistResponse, canViewPlaylist, canViewVideo, PlaylistType, VideoType } from "../../lib/playlists";
import { resolvePlaylistCovers, type PlaylistCover } from "../../lib/playlistCovers";
import { logger } from "../../lib/logger";
import { canManageChannelPlaylists } from "../../lib/playlistBulk";
import { isSystemPlaylist } from "../../lib/library";
import { orderedPlaylist, refreshStoredOrder } from "../../lib/playlistOrder";
import { waitUntilOf } from "../../lib/search/ownership";
import { playlistSortOf } from "@al-ummah/shared-types";
import { channelNameFields } from "../../lib/channelName";

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

        // Deleted, hidden and other users' private playlists all look "not found".
        // A private channel playlist is also shown to the channel's playlist
        // managers (owner, admins, editors: playlist.manage).
        const visible = !!playlist && (canViewPlaylist(playlist, userId)
            || (!playlist.isDeleted && !playlist.isHidden && playlist.isPublic === false && !isSystemPlaylist(playlist) && await canManageChannelPlaylists(c.env as never, playlist.channelId, userId)));
        if (!playlist || !visible) {
            return c.json({ success: false, error: "Playlist not found" }, 404);
        }

        const response: ReturnType<typeof toPlaylistResponse> & {
            channelName?: string;
            channelNameLocalized?: Record<string, string>;
            cover?: PlaylistCover;
            videoItems?: ReturnType<typeof transformVideoToView>[];
        } = toPlaylistResponse(playlist);

        // A system playlist (Watch later) belongs to its user, not to a channel
        if (playlist.channelId && !isSystemPlaylist(playlist)) {
            try {
                const channelRepo = new R2Repository<z.infer<typeof BusinessChannel>>(c.env.channels);
                const channel = await channelRepo.getObject(playlist.channelId);
                // Every language's name (lib/channelName.ts)
                Object.assign(response, channelNameFields(channel));
            } catch (error) {
                logger.warn("[PlaylistFetch] Failed to load channel", {
                    playlistId: id,
                    channelId: playlist.channelId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        // The playlist's order, applied before anything is cut (automatic
        // orders sort from fresh video data; a changed order is stored back)
        const ordered = await orderedPlaylist(c.env as never, playlist);
        response.videos = ordered.ids;
        Object.assign(response, playlistSortOf(playlist));
        refreshStoredOrder(c.env as never, playlist, ordered.ids, ordered.videos, waitUntilOf(c as never));

        if (includeVideos) {
            const videoRepo = new R2Repository<VideoType>(c.env.videos);
            const ids = ordered.ids.slice(0, MAX_EXPANDED_VIDEOS);
            const videos = await Promise.all(ids.map((videoId) => ordered.videos.get(videoId) ?? videoRepo.getObject(videoId)));
            // Each item carries the one URL its player plays (lib/media/playback.ts)
            response.videoItems = await Promise.all(videos
                .filter((video): video is VideoType => !!video && canViewVideo(video, userId))
                .map((video) => withPlayback(c.env as never, video as never, transformVideoToView(video), 'playlist')));

            logger.debug("[PlaylistFetch] Expanded playlist videos", {
                playlistId: id,
                requested: ids.length,
                returned: response.videoItems.length,
            });

            // The expanded list is already filtered for this viewer
            const first = playlist.thumbnailUrl ? undefined : response.videoItems.find((video) => video.thumbnailUrl);
            if (first?.thumbnailUrl) response.cover = { videoId: first.id, thumbnailUrl: first.thumbnailUrl };
        } else {
            const cover = (await resolvePlaylistCovers(c.env, [{ ...playlist, videos: ordered.ids }], userId)).get(id);
            if (cover) response.cover = cover;
        }

        return response;
    }
}
