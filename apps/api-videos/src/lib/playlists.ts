import { isVideoListedFor } from './visibility';
import { playlistSortOf } from '@al-ummah/shared-types';
/**
 * Playlist helpers shared by playlist endpoints.
 */

import { z } from "zod";
import { Playlist as BusinessPlaylist, Video as BusinessVideo } from "./types";

export type PlaylistType = z.infer<typeof BusinessPlaylist>;
export type VideoType = z.infer<typeof BusinessVideo>;

/** Longest stored playlist title / description (the web form uses the same limits). */
export const PLAYLIST_TITLE_MAX = 150;
export const PLAYLIST_DESCRIPTION_MAX = 5000;

/**
 * Public playlist shape returned by list/fetch.
 *
 * Keeps the stored fields (including the ordered `videos` ID array) and adds
 * `name` (the shared-types Playlist uses `name`, storage uses `title`) and
 * `videosCount` so web components can use either naming.
 */
export function toPlaylistResponse(playlist: PlaylistType) {
    // Internal: the upload order of queued adds (lib/playlistUploadAdds.ts),
    // and the add dates and refresh time behind the server-side order
    const { uploadOrder: _uploadOrder, videoAddedAt: _addedAt, orderRefreshedAt: _refreshedAt, ...stored } = playlist as PlaylistType & { uploadOrder?: unknown };
    return {
        ...stored,
        name: playlist.title,
        // Older playlists without a stored order are manual
        ...playlistSortOf(playlist),
        videos: playlist.videos || [],
        videosCount: playlist.videos?.length || 0,
    };
}

/**
 * Whether a playlist is visible to the (optional) requesting user.
 */
export function canViewPlaylist(playlist: PlaylistType, userId?: string | null): boolean {
    if (playlist.isDeleted || playlist.isHidden) return false;
    if (playlist.isPublic === false) return !!userId && playlist.userId === userId;
    return true;
}

/**
 * Whether a video inside a playlist may be shown to the requesting user.
 * Deleted/hidden videos are never shown; private videos only to their owner.
 */
export function canViewVideo(video: VideoType, userId?: string | null): boolean {
    if (!isVideoListedFor(video, userId)) return false;
    return true;
}

/**
 * Validate a reorder request: the new order must contain exactly the same
 * video IDs as the current playlist (no additions, removals or duplicates).
 */
export function isSameVideoSet(current: string[], next: string[]): boolean {
    if (current.length !== next.length) return false;
    const nextSet = new Set(next);
    if (nextSet.size !== next.length) return false;
    return current.every((id) => nextSet.has(id));
}
