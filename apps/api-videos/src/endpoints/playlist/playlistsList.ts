import { Num, Str } from "chanfana";
import { canManagePlaylist } from "../../lib/channelAccess";
import { string, z } from "zod";
import { Playlist, PaginationResponse, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from "../../base";
import { toPlaylistResponse, canViewPlaylist } from "../../lib/playlists";
import { withPlaylistCovers } from "../../lib/playlistCovers";
import { logger } from "../../lib/logger";
import { isSystemPlaylist } from "../../lib/library";

// Bounds for scanning the playlists bucket when filtering by channel
const CHANNEL_SCAN_PAGE_SIZE = 100;
const CHANNEL_SCAN_MAX_PAGES = 20;

export class PlaylistsList extends OptionalAuthRoute {
    schema = {
        tags: ["Playlists"],
        summary: "List Playlists",
        request: {
            query: z.object({
                limit: Num({
                    description: "Limit the number of playlists to return",
                    default: 10,
                }),
                cursor: string({
                    description: "The last cursor returned from the previous request",
                }).optional(),
                channelId: string({
                    description: "Only return playlists that belong to this channel (cursor is ignored; up to `limit` newest playlists)",
                }).optional(),
            }),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
        },
        responses: {
            "200": {
                description: "Returns a list of playlists",
                content: {
                    "application/json": {
                        schema: PaginationResponse.extend({ data: z.array(Playlist) }),
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
        const { limit, cursor, channelId: channelFilter } = request.query;
        const userId = this.getUserId(c);

        type PlaylistType = z.infer<typeof Playlist>;
        const repository = new R2Repository<PlaylistType>(c.env.playlists);

        if (channelFilter) {
            // R2 has no secondary index, so scan pages and filter by channel.
            const matches: PlaylistType[] = [];
            // The channel's managers (owner, admin, editor) see its private playlists too
            const manages = await canManagePlaylist(c.env as never, { channelId: channelFilter }, userId);
            let scanCursor: string | undefined;
            for (let page = 0; page < CHANNEL_SCAN_MAX_PAGES; page++) {
                const result = await repository.listObjects(CHANNEL_SCAN_PAGE_SIZE, scanCursor);
                for (const playlist of result.items || []) {
                    if (playlist.channelId === channelFilter && (canViewPlaylist(playlist, userId) || (manages && !playlist.isDeleted && !playlist.isHidden)) && !isSystemPlaylist(playlist)) {
                        matches.push(playlist);
                    }
                }
                if (!result.cursor) break;
                scanCursor = result.cursor;
            }

            matches.sort((a, b) => (b.dateModified || '').localeCompare(a.dateModified || ''));

            logger.debug('[PlaylistsList] Channel playlists listed', {
                channelId: channelFilter,
                count: matches.length,
            });

            return {
                cursor: "",
                limit,
                data: await withPlaylistCovers(c.env, matches.slice(0, limit).map(toPlaylistResponse), userId),
            };
        }

        const playlists = !cursor ? await repository.listObjects(limit) : await repository.listObjects(limit, cursor);
        // System playlists (Watch later) are listed in the Library, not with user playlists
        const visible = (playlists.items || []).filter((playlist) => canViewPlaylist(playlist, userId) && !isSystemPlaylist(playlist));

        const response = {
            cursor: playlists.cursor || "",
            limit,
            data: await withPlaylistCovers(c.env, visible.map(toPlaylistResponse), userId),
        };

        return response;
    }
}
