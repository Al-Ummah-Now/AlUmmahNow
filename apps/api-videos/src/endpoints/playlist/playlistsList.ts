import { Num, Str } from "../../lib/chanfana-params";
import { canManagePlaylist } from "../../lib/channelAccess";
import { string, z } from "zod";
import { Playlist, PaginationResponse, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from "../../base";
import { toPlaylistResponse, canViewPlaylist, isPersonalPlaylist } from "../../lib/playlists";
import { collectPersonalPlaylists } from "../../lib/personalPlaylists";
import { withPlaylistCovers } from "../../lib/playlistCovers";
import { logger } from "../../lib/logger";
import { isSystemPlaylist } from "../../lib/library";
import { scanFill } from "../../lib/listFill";
import { normalizeTitleQuery } from "../video/videoList";

// Bounds for scanning the playlists bucket when filtering by channel
const CHANNEL_SCAN_PAGE_SIZE = 100;
const CHANNEL_SCAN_MAX_PAGES = 20;

/** Where a channelId/mine page starts: their cursor is the offset of the next page. */
export function pageOffset(cursor: string | undefined): number {
    const n = Number.parseInt(cursor ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Whether the playlist's name (title, name or a translation) contains `query` (normalizeTitleQuery). */
export function playlistMatches(playlist: { title?: unknown; name?: unknown; titleLocalized?: unknown }, query: string): boolean {
    const localized = playlist.titleLocalized && typeof playlist.titleLocalized === "object" ? Object.values(playlist.titleLocalized as Record<string, unknown>) : [];
    return [playlist.title, playlist.name, ...localized].some((text) => typeof text === "string" && text.normalize("NFKC").toLocaleLowerCase().includes(query));
}

/** One page of the sorted matches, and the cursor of the next ('' after the last). */
function slicePage<T>(matches: T[], cursor: string | undefined, limit: number): { items: T[]; cursor: string } {
    const offset = pageOffset(cursor);
    const items = matches.slice(offset, offset + limit);
    const next = offset + items.length;
    return { items, cursor: next < matches.length ? String(next) : "" };
}

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
                cursor: string().describe("The last cursor returned from the previous request").optional(),
                channelId: string().describe("Only return playlists that belong to this channel, newest first, `limit` at a time: follow `cursor` for the next page (empty after the last)").optional(),
                mine: z.enum(["true", "false"]).optional().describe("true (signed in): the caller's personal playlists, made without a channel, private and unlisted ones included, newest first, `limit` at a time: follow `cursor` for the next page (empty after the last). Channel playlists are listed with channelId"),
                q: Str({ description: "With channelId or mine: only playlists whose name (any language, case-insensitive) contains this text" }).max(200).optional(),
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
        const { limit, cursor, channelId: channelFilter, mine, q } = request.query;
        const query = normalizeTitleQuery(q);
        const named = <T extends { title?: unknown; name?: unknown; titleLocalized?: unknown }>(list: T[]) => query ? list.filter((p) => playlistMatches(p, query)) : list;
        const userId = this.getUserId(c);

        type PlaylistType = z.infer<typeof Playlist>;
        const repository = new R2Repository<PlaylistType>(c.env.playlists);

        if (mine === 'true') {
            if (!userId) return c.json({ success: false, error: "Sign in to list your playlists" }, 401);
            const own = (playlist: PlaylistType | null): playlist is PlaylistType =>
                !!playlist && playlist.userId === userId && isPersonalPlaylist(playlist)
                && !playlist.isDeleted && !playlist.isHidden && !isSystemPlaylist(playlist);
            const { playlists: matches, source } = await collectPersonalPlaylists(c.env, userId, own);
            matches.sort((a, b) => (b.dateModified || '').localeCompare(a.dateModified || ''));
            const page = slicePage(named(matches), cursor, limit);
            logger.debug('[PlaylistsList] Personal playlists listed', { userId, count: matches.length, source });
            return {
                cursor: page.cursor,
                limit,
                data: await withPlaylistCovers(c.env, page.items.map(toPlaylistResponse), userId),
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
            const page = slicePage(named(matches), cursor, limit);

            logger.debug('[PlaylistsList] Channel playlists listed', {
                channelId: channelFilter,
                count: matches.length,
            });

            return {
                cursor: page.cursor,
                limit,
                data: await withPlaylistCovers(c.env, page.items.map(toPlaylistResponse), userId),
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
