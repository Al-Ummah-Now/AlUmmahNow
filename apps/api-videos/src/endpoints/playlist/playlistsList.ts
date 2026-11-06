import { Num, Str } from "chanfana";
import { string, z } from "zod";
import { Playlist, PaginationResponse, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from "../../base";
import { toPlaylistResponse, canViewPlaylist } from "../../lib/playlists";
import { logger } from "../../lib/logger";

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
            let scanCursor: string | undefined;
            for (let page = 0; page < CHANNEL_SCAN_MAX_PAGES; page++) {
                const result = await repository.listObjects(CHANNEL_SCAN_PAGE_SIZE, scanCursor);
                for (const playlist of result.items || []) {
                    if (playlist.channelId === channelFilter && canViewPlaylist(playlist, userId)) {
                        matches.push(playlist);
                    }
                }
                if (!result.cursor) break;
                scanCursor = result.cursor;
            }

            matches.sort((a, b) => (b.dateModified || '').localeCompare(a.dateModified || ''));

            logger.info('[PlaylistsList] Channel playlists listed', {
                channelId: channelFilter,
                count: matches.length,
            });

            return {
                cursor: "",
                limit,
                data: matches.slice(0, limit).map(toPlaylistResponse),
            };
        }

        const playlists = !cursor ? await repository.listObjects(limit) : await repository.listObjects(limit, cursor);
        const visible = (playlists.items || []).filter((playlist) => canViewPlaylist(playlist, userId));

        const response: PaginationResponse<ReturnType<typeof toPlaylistResponse>> = {
            cursor: playlists.cursor || "",
            limit,
            data: visible.map(toPlaylistResponse),
        };

        return response;
    }
}
