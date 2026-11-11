import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Playlist as BusinessPlaylist, ResponseError } from "../../lib/types";
import { PlaylistUpdateInput } from "../../lib/model/input";
import { PlaylistView } from "../../lib/model/view";
import { transformPlaylistToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";
import { PLAYLIST_DESCRIPTION_MAX, PLAYLIST_TITLE_MAX, isSameVideoSet } from "../../lib/playlists";
import { canManagePlaylist } from "../../lib/playlistBulk";
import { loadPlaylistVideos, orderOf, persistAutoOrder } from "../../lib/playlistOrder";
import { normalizePlaylistLocalized, playlistSortOf } from "@al-ummah/shared-types";

export class PlaylistUpdate extends AuthenticatedRoute {
    schema = {
        tags: ["Playlists"],
        summary: "Update a playlist",
        request: {
            params: z.object({
                id: Str({ description: "Playlist ID" }),
            }),
            headers: z.object({
                channelId: Str({ description: "Channel ID" }),
            }),
            body: {
                content: {
                    "application/json": {
                        schema: PlaylistUpdateInput,
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Returns the updated playlist",
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
            "404": {
                description: "Playlist not found",
                content: {
                    "application/json": {
                        schema: ResponseError,
                    },
                },
            },
            "409": {
                description: "Reorder refused: the playlist is sorted automatically",
                content: { "application/json": { schema: ResponseError } },
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

        // Retrieve the validated parameters
        const { id } = request.params;
        const { channelId } = request.headers;
        const userId = this.getUserId(c);
        const updateData = request.body;

        // Get existing playlist
        const bucket = c.env.playlists;
        type PlaylistType = z.infer<typeof BusinessPlaylist>;
        const repository = new R2Repository<PlaylistType>(bucket);
        
        const existingPlaylist = await repository.getObject(id);
        if (!existingPlaylist) {
            return c.json({
                success: false,
                error: "Playlist not found",
            }, 404);
        }

        // The owner, or a role on the playlist's channel granting playlist.manage
        // (the channelId header is optional, so it cannot be the check on its own)
        if (!(await canManagePlaylist(c.env as never, existingPlaylist, userId))) {
            return c.json({
                success: false,
                error: "Unauthorized - you can only update your own playlists",
            }, 403);
        }

        // The order: manual, or automatic by a field and direction. Switching
        // to automatic sorts now; switching back to manual keeps the current
        // automatic order as the starting manual order. Both need the videos.
        const { sortMode, sortField, sortDirection, coverVideoId, titleLocalized, descriptionLocalized, ...fields } = updateData;
        if (fields.title !== undefined) {
            fields.title = fields.title.trim().slice(0, PLAYLIST_TITLE_MAX);
            if (!fields.title) delete fields.title;
        }
        if (fields.description !== undefined) fields.description = fields.description.slice(0, PLAYLIST_DESCRIPTION_MAX);
        // Bilingual name and description: a sent map replaces the stored one ({} clears it)
        const names = titleLocalized !== undefined ? normalizePlaylistLocalized(titleLocalized, PLAYLIST_TITLE_MAX) ?? null : undefined;
        const descriptions = descriptionLocalized !== undefined ? normalizePlaylistLocalized(descriptionLocalized, PLAYLIST_DESCRIPTION_MAX) ?? null : undefined;
        const sortChange = sortMode !== undefined || sortField !== undefined || sortDirection !== undefined;
        const before = playlistSortOf(existingPlaylist);
        const after = playlistSortOf({ ...before, ...(sortMode ? { sortMode } : {}), ...(sortField ? { sortField } : {}), ...(sortDirection ? { sortDirection } : {}) });
        const known = sortChange && (before.sortMode === 'auto' || after.sortMode === 'auto')
            ? await loadPlaylistVideos(c.env as never, existingPlaylist.videos || [])
            : new Map();

        // Checked and applied on the fresh playlist with a conditional write
        // (SCALABILITY-AUDIT AV-19): a rename during an add no longer reverts it
        const { data: updatedPlaylist, rejected } = await repository.updateObjectOrReject<{ status: 400 | 409; error: string }>(id, (fresh) => {
            const freshBefore = playlistSortOf(fresh);
            const target = sortChange ? after : freshBefore;
            if (fields.videos && target.sortMode === 'auto') {
                return { reject: { status: 409, error: "This playlist is sorted automatically: switch it to manual order to reorder it by hand" } };
            }
            // Reordering: the new order must be a permutation of the current videos
            if (updateData.videos && !isSameVideoSet(fresh.videos || [], updateData.videos)) {
                return { reject: { status: 400, error: "videos must contain exactly the playlist's current video IDs (use the add/remove endpoints to change membership)" } };
            }
            // The cover is one of the playlist's own videos (null: automatic again)
            if (coverVideoId && !(fresh.videos || []).includes(coverVideoId)) {
                return { reject: { status: 400, error: "coverVideoId must be a video of this playlist" } };
            }
            Object.assign(fresh, fields, { dateModified: new Date().toISOString() });
            if (names !== undefined) {
                if (names) fresh.titleLocalized = names;
                else delete fresh.titleLocalized;
                if (fields.title === undefined) fresh.title = names?.en || names?.ar || fresh.title;
            }
            if (descriptions !== undefined) {
                if (descriptions) fresh.descriptionLocalized = descriptions;
                else delete fresh.descriptionLocalized;
                if (fields.description === undefined) {
                    const fallback = descriptions?.en || descriptions?.ar;
                    if (fallback) fresh.description = fallback;
                }
            }
            if (coverVideoId === null) delete fresh.coverVideoId;
            else if (coverVideoId) fresh.coverVideoId = coverVideoId;
            if (sortChange) {
                if (target.sortMode === 'auto') fresh.videos = orderOf(fresh, known, target);
                else if (freshBefore.sortMode === 'auto') fresh.videos = orderOf(fresh, known, freshBefore);
                if (target.sortMode === 'auto') fresh.orderRefreshedAt = new Date().toISOString();
                fresh.sortMode = target.sortMode;
                fresh.sortField = target.sortField;
                fresh.sortDirection = target.sortDirection;
            }
            return true;
        });
        if (!updatedPlaylist) {
            return c.json({ success: false, error: "Playlist not found" }, 404);
        }
        if (rejected) {
            return c.json({ success: false, ...(rejected.status === 409 ? { code: "PLAYLIST_SORT_AUTOMATIC" } : {}), error: rejected.error }, rejected.status);
        }
        // Videos added during the switch get their automatic place too
        if (sortChange && after.sortMode === 'auto') {
            const ordered = await persistAutoOrder(c.env as never, id, known);
            if (ordered) updatedPlaylist.videos = ordered;
        }

        // Send queue message for playlist update
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.PlaylistEdit, {
            playlistId: id,
            userId: userId,
            channelId: channelId,
            timestamp: new Date().toISOString(),
        });

        // Transform to view model for response
        const playlistView = transformPlaylistToView(updatedPlaylist);

        return {
            success: true,
            result: {
                playlist: playlistView,
            },
        };
    }
}