import { Str } from "chanfana";
import { withPlayback } from '../../lib/media/playback';
import { z } from "zod";
import { Playlist, Channel as BusinessChannel, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from "../../base";
import { transformVideoToView } from "../../lib/transformations";
import { toPlaylistResponse, canOpenPlaylist, canViewVideo, PlaylistType, VideoType } from "../../lib/playlists";
import { resolvePlaylistCovers, type PlaylistCover } from "../../lib/playlistCovers";
import { logger } from "../../lib/logger";
import { canManageChannelPlaylists } from "../../lib/playlistBulk";
import { isSystemPlaylist } from "../../lib/library";
import { orderedPlaylist, refreshStoredOrder } from "../../lib/playlistOrder";
import { waitUntilOf } from "../../lib/search/ownership";
import { playlistSortOf } from "@al-ummah/shared-types";
import { channelNameFields } from "../../lib/channelName";
import { GONE_BODY, isPurged } from '../../lib/gone';
import { edgeCacheUrl, readEdgeCache, writeEdgeCache } from '../../lib/edge-cache';

// Upper bound on videos resolved for a single playlist page
const MAX_EXPANDED_VIDEOS = 200;

/**
 * An anonymous expanded playlist is reused on the edge this long (per colo, lib/edge-cache.ts), like
 * the anonymous first page of GET /api/videos: its R2 reads (playlist, channel, every video) are most
 * of the playlist page's time to first byte. Signed-in viewers (owners included) always read fresh,
 * so an edit is seen at once by its author and by everyone else within the TTL. Only the R2 data is
 * kept: the playback choice (R2 or Bunny, signing) still runs for each request.
 */
export const EXPANDED_PLAYLIST_TTL_SECONDS = 30;

type PlaylistView = ReturnType<typeof transformVideoToView>;
type PlaylistBody = ReturnType<typeof toPlaylistResponse> & {
    channelName?: string;
    channelNameLocalized?: Record<string, string>;
    cover?: PlaylistCover;
    videoItems?: PlaylistView[];
};
/** What the anonymous edge entry holds: the response before playback, and each item's view + R2 state */
interface ExpandedEntry {
    body: PlaylistBody;
    /** What withPlayback reads: id, r2 and the visibility flags publicMp4Url checks before naming an MP4 */
    items: { view: PlaylistView; video: Pick<VideoType, 'id'> & { r2?: unknown; isPublic?: boolean; isDeleted?: boolean; isHidden?: boolean } }[];
    hasOwnThumbnail: boolean;
}

/** Each item gets the one URL its player plays (lib/media/playback.ts), then the cover if the playlist has none */
function playbackFields(video: VideoType): ExpandedEntry['items'][number]['video'] {
    const v = video as VideoType & { r2?: unknown; isDeleted?: boolean; isHidden?: boolean };
    return { id: v.id, r2: v.r2, isPublic: v.isPublic, isDeleted: v.isDeleted, isHidden: v.isHidden };
}

async function finishExpanded(env: never, entry: ExpandedEntry): Promise<PlaylistBody> {
    const body: PlaylistBody = { ...entry.body };
    body.videoItems = await Promise.all(entry.items.map(({ view, video }) => withPlayback(env, video as never, { ...view }, 'playlist')));
    const first = entry.hasOwnThumbnail ? undefined : body.videoItems.find((video) => video.thumbnailUrl);
    if (first?.thumbnailUrl) body.cover = { videoId: first.id, thumbnailUrl: first.thumbnailUrl };
    return body;
}

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

        // Anonymous expanded reads (the playlist page's server render) may come from the edge
        const cacheUrl = !userId && includeVideos ? edgeCacheUrl(c.req.url, `playlist-expanded/${encodeURIComponent(id)}`) : null;
        if (cacheUrl) {
            const hit = await readEdgeCache<ExpandedEntry>(cacheUrl);
            if (hit) return finishExpanded(c.env as never, hit);
        }

        const repository = new R2Repository<PlaylistType>(c.env.playlists);
        const playlist = await repository.getObject(id);

        // Deleted, hidden and other users' private playlists all look "not found".
        // A private channel playlist is also shown to the channel's playlist
        // managers (owner, admins, editors: playlist.manage).
        const visible = !!playlist && (canOpenPlaylist(playlist, userId)
            || (!playlist.isDeleted && !playlist.isHidden && playlist.isPublic === false && !isSystemPlaylist(playlist) && await canManageChannelPlaylists(c.env as never, playlist.channelId, userId)));
        if (!playlist || !visible) {
            // Purged (deleted, then removed for good): 410 (lib/gone.ts)
            if (!playlist && await isPurged(c.env as never, 'playlist', id)) return c.json(GONE_BODY, 410);
            return c.json({ success: false, error: "Playlist not found" }, 404);
        }

        const response: PlaylistBody = toPlaylistResponse(playlist);

        // A system playlist (Watch later) belongs to its user, not to a channel. Read alongside the
        // order and the videos below, not before them: it is one R2 round trip off the critical path.
        const channelRead = playlist.channelId && !isSystemPlaylist(playlist)
            ? new R2Repository<z.infer<typeof BusinessChannel>>(c.env.channels).getObject(playlist.channelId).catch((error) => {
                logger.warn("[PlaylistFetch] Failed to load channel", {
                    playlistId: id,
                    channelId: playlist.channelId,
                    error: error instanceof Error ? error.message : String(error),
                });
                return null;
            })
            : Promise.resolve(null);

        // The playlist's order, applied before anything is cut (automatic
        // orders sort from fresh video data; a changed order is stored back)
        const ordered = await orderedPlaylist(c.env as never, playlist);
        response.videos = ordered.ids;
        Object.assign(response, playlistSortOf(playlist));
        refreshStoredOrder(c.env as never, playlist, ordered.ids, ordered.videos, waitUntilOf(c as never));

        if (includeVideos) {
            const videoRepo = new R2Repository<VideoType>(c.env.videos);
            const ids = ordered.ids.slice(0, MAX_EXPANDED_VIDEOS);
            const [videos, channel] = await Promise.all([
                Promise.all(ids.map((videoId) => ordered.videos.get(videoId) ?? videoRepo.getObject(videoId))),
                channelRead,
            ]);
            // Every language's name (lib/channelName.ts)
            if (channel) Object.assign(response, channelNameFields(channel));
            const entry: ExpandedEntry = {
                body: response,
                items: videos
                    .filter((video): video is VideoType => !!video && canViewVideo(video, userId))
                    .map((video) => ({ view: transformVideoToView(video), video: playbackFields(video) })),
                // The expanded list is already filtered for this viewer
                hasOwnThumbnail: !!playlist.thumbnailUrl,
            };
            logger.debug("[PlaylistFetch] Expanded playlist videos", { playlistId: id, requested: ids.length, returned: entry.items.length });
            // Stored before playback, so each later request still makes its own choice and signs its own URLs
            if (cacheUrl) writeEdgeCache(cacheUrl, entry, EXPANDED_PLAYLIST_TTL_SECONDS, waitUntilOf(c as never));
            return finishExpanded(c.env as never, entry);
        }

        const [channel, covers] = await Promise.all([channelRead, resolvePlaylistCovers(c.env, [{ ...playlist, videos: ordered.ids }], userId)]);
        if (channel) Object.assign(response, channelNameFields(channel));
        const cover = covers.get(id);
        if (cover) response.cover = cover;

        return response;
    }
}
