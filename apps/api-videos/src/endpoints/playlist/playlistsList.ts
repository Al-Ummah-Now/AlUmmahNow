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
import { playlistListIds, scheduleOwnershipHeal, waitUntilOf } from "../../lib/search/ownership";
import { pageFromIndex } from "../../lib/search/indexPage";
import { scanPage } from "../../lib/scanCursor";


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

        // The channel's managers (owner, admin, editor) see its private playlists too
        const manages = channelFilter ? await canManagePlaylist(c.env as never, { channelId: channelFilter }, userId) : false;
        // System playlists (Watch later) are listed in the Library, not with user playlists
        const isListed = (playlist: PlaylistType | null): playlist is PlaylistType =>
            !!playlist &&
            !isSystemPlaylist(playlist) &&
            (!channelFilter || playlist.channelId === channelFilter) &&
            (canViewPlaylist(playlist, userId) || (manages && !playlist.isDeleted && !playlist.isHidden));

        // A channel's playlists by last change (as before), every playlist newest
        // first: one keyset page of the ownership index (kind 'playlist')
        const sort = channelFilter ? 'updated' as const : 'latest' as const;
        const indexed = await pageFromIndex<PlaylistType>({
            cursor,
            sort,
            limit,
            fetch: (after, pageLimit) => playlistListIds(c.env as never, {
                channelId: channelFilter || null,
                sort,
                limit: pageLimit,
                after,
                privateFor: manages ? true : (userId || null),
            }),
            load: (id) => repository.getObject(id),
            isListed,
        });

        let items: PlaylistType[];
        let nextCursor: string;
        if (indexed) {
            items = indexed.items;
            nextCursor = indexed.cursor;
        } else {
            // Index unavailable: a bounded scan whose cursor keeps its place in the
            // R2 listing (lib/scanCursor.ts), and the index rebuild is queued
            if (!cursor) scheduleOwnershipHeal(c.env as never, waitUntilOf(c as never), 'playlist');
            const scanned = await scanPage<PlaylistType>({
                cursor,
                limit,
                list: async (pageCursor, pageSize) => {
                    const batch = await repository.listObjects(pageSize, pageCursor);
                    return { items: batch.items || [], cursor: batch.cursor || "" };
                },
                isListed,
            });
            items = scanned.items;
            nextCursor = scanned.cursor;
            if (channelFilter) items.sort((a, b) => (b.dateModified || '').localeCompare(a.dateModified || ''));
        }

        logger.debug('[PlaylistsList] Playlists listed', { channelId: channelFilter, count: items.length, source: indexed ? 'index' : 'scan' });

        return {
            cursor: nextCursor,
            limit,
            data: await withPlaylistCovers(c.env, items.map(toPlaylistResponse), userId),
        };
    }
}
