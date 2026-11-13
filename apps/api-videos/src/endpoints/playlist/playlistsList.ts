import { Num, Str } from "chanfana";
import { canManagePlaylist } from "../../lib/channelAccess";
import { string, z } from "zod";
import { Playlist, PaginationResponse, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from "../../base";
import { toPlaylistResponse, canViewPlaylist, isPersonalPlaylist } from "../../lib/playlists";
import { footprintsComplete, footprintTargets } from "../../lib/privacy/footprints";
import type { SearchDb } from "@al-ummah/shared-types";
import { withPlaylistCovers } from "../../lib/playlistCovers";
import { logger } from "../../lib/logger";
import { isSystemPlaylist } from "../../lib/library";
import { scanFill } from "../../lib/listFill";

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
                mine: z.enum(["true", "false"]).optional().describe("true (signed in): the caller's personal playlists, made without a channel, private and unlisted ones included, newest first (cursor is ignored; up to `limit`). Channel playlists are listed with channelId"),
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
        const { limit, cursor, channelId: channelFilter, mine } = request.query;
        const userId = this.getUserId(c);

        type PlaylistType = z.infer<typeof Playlist>;
        const repository = new R2Repository<PlaylistType>(c.env.playlists);

        if (mine === 'true') {
            if (!userId) return c.json({ success: false, error: "Sign in to list your playlists" }, 401);
            const own = (playlist: PlaylistType | null): playlist is PlaylistType =>
                !!playlist && playlist.userId === userId && isPersonalPlaylist(playlist)
                && !playlist.isDeleted && !playlist.isHidden && !isSystemPlaylist(playlist);
            const matches: PlaylistType[] = [];
            // The privacy footprints name every playlist's owner: read just those once the
            // index is trusted (a superset: the record decides); otherwise a bounded scan
            const db = (c.env as { SEARCH_DB?: SearchDb }).SEARCH_DB;
            const indexed = db && await footprintsComplete(db, 'playlists').catch(() => false)
                ? await footprintTargets(db, userId, 'playlist').catch(() => null)
                : null;
            if (indexed) {
                for (const p of await Promise.all(indexed.map((key) => repository.getObject(key).catch(() => null)))) {
                    if (own(p)) matches.push(p);
                }
            } else {
                let scanCursor: string | undefined;
                for (let page = 0; page < CHANNEL_SCAN_MAX_PAGES; page++) {
                    const result = await repository.listObjects(CHANNEL_SCAN_PAGE_SIZE, scanCursor);
                    for (const playlist of result.items || []) if (own(playlist)) matches.push(playlist);
                    if (!result.cursor) break;
                    scanCursor = result.cursor;
                }
            }
            matches.sort((a, b) => (b.dateModified || '').localeCompare(a.dateModified || ''));
            logger.debug('[PlaylistsList] Personal playlists listed', { userId, count: matches.length, source: indexed ? 'footprints' : 'scan' });
            return {
                cursor: "",
                limit,
                data: await withPlaylistCovers(c.env, matches.slice(0, limit).map(toPlaylistResponse), userId),
            };
        }

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

        // Fill the page: filtering a cut R2 page returned empty pages with a
        // cursor when the first keys were private or system playlists (lib/listFill.ts).
        const scan = await scanFill<PlaylistType>({
            bucket: c.env.playlists,
            cursor,
            limit,
            load: key => repository.getObject(key),
            // System playlists (Watch later) are listed in the Library, not with user playlists
            isListed: (playlist): playlist is PlaylistType => Boolean(playlist) && canViewPlaylist(playlist, userId) && !isSystemPlaylist(playlist),
            label: 'PlaylistsList',
        });

        const response = {
            cursor: scan.cursor,
            limit,
            data: await withPlaylistCovers(c.env, scan.items.map(toPlaylistResponse), userId),
        };

        return response;
    }
}
