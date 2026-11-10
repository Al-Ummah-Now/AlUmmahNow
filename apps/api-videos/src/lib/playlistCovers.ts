/**
 * Playlist covers derived at read time.
 *
 * Contract: `playlist.thumbnailUrl` is only ever the creator's custom image.
 * When it is not set, responses carry `cover: { videoId, thumbnailUrl }`, the
 * video the managers chose (`coverVideoId`) when the viewer can see it, else
 * the first video in playlist order that the viewer can see and that has a
 * thumbnail. Nothing is persisted, so a cover follows the playlist's order and
 * its videos' visibility.
 *
 * `cover` is an object on purpose: bunnySigningMiddleware signs a thumbnail
 * only when it sits next to the id of the video it belongs to, so the plain
 * URL returned here gets a fresh token per response without widening what the
 * signer accepts.
 *
 * Cost: one search-index query per response. R2 is read only for ids the index
 * cannot answer (a private video the viewer owns, or an unindexed video), up
 * to MAX_COVER_R2_READS per response.
 */

import { SEARCH_TABLES, type SearchDb } from "@al-ummah/shared-types";
import R2Repository from "./r2Repo";
import { logger } from "./logger";
import { canViewVideo, type VideoType } from "./playlists";

export interface PlaylistCover {
    videoId: string;
    thumbnailUrl: string;
}

export interface PlaylistCoverSource {
    id?: string;
    userId?: string;
    thumbnailUrl?: string;
    videos?: string[];
    /** The managers' chosen cover video: tried first, while it is in the playlist */
    coverVideoId?: string;
}

export interface PlaylistCoverEnv {
    videos: R2Bucket;
    SEARCH_DB?: unknown;
}

/** Videos considered per playlist before it falls back to the placeholder */
export const COVER_CANDIDATES = 5;
export const MAX_COVER_R2_READS = 24;
/** D1 allows 100 bound parameters per statement */
const INDEX_CHUNK_SIZE = 90;

function candidatesOf(playlist: PlaylistCoverSource): string[] {
    const videos = playlist.videos || [];
    const chosen = playlist.coverVideoId && videos.includes(playlist.coverVideoId) ? playlist.coverVideoId : null;
    // The chosen cover first; a viewer who cannot see it gets the first visible video
    const ordered = chosen ? [chosen, ...videos.filter((id) => id !== chosen)] : videos;
    return ordered.slice(0, COVER_CANDIDATES);
}

/** Thumbnails of the public videos among `ids`; empty when the index is unavailable. */
async function readIndexedThumbnails(db: SearchDb | undefined, ids: string[]): Promise<Map<string, string>> {
    const thumbnails = new Map<string, string>();
    if (!db || ids.length === 0) return thumbnails;

    try {
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += INDEX_CHUNK_SIZE) chunks.push(ids.slice(i, i + INDEX_CHUNK_SIZE));
        const pages = await Promise.all(chunks.map((chunk) =>
            db.prepare(`SELECT id, payload FROM ${SEARCH_TABLES.video.base} WHERE visible = 1 AND id IN (${chunk.map(() => "?").join(",")})`)
                .bind(...chunk)
                .all<{ id: string; payload: string }>()
        ));
        for (const page of pages) {
            for (const row of page.results || []) {
                const thumbnailUrl = (JSON.parse(row.payload) as { thumbnailUrl?: string }).thumbnailUrl;
                if (thumbnailUrl) thumbnails.set(row.id, thumbnailUrl);
            }
        }
    } catch (error) {
        logger.warn("[PlaylistCovers] Search index lookup failed; falling back to R2", {
            error: error instanceof Error ? error.message : String(error),
        });
        thumbnails.clear();
    }
    return thumbnails;
}

async function readVideos(bucket: R2Bucket, ids: string[]): Promise<Map<string, VideoType | null>> {
    const repository = new R2Repository<VideoType>(bucket);
    const entries = await Promise.all(ids.map(async (id) => {
        try {
            return [id, await repository.getObject(id)] as const;
        } catch {
            return [id, null] as const;
        }
    }));
    return new Map(entries);
}

/** Covers keyed by playlist id, for the playlists that have no custom thumbnail. */
export async function resolvePlaylistCovers(
    env: PlaylistCoverEnv,
    playlists: PlaylistCoverSource[],
    userId?: string | null,
): Promise<Map<string, PlaylistCover>> {
    const pending = playlists.filter((playlist) => playlist.id && !playlist.thumbnailUrl && candidatesOf(playlist).length > 0);
    const covers = new Map<string, PlaylistCover>();
    if (pending.length === 0) return covers;

    const indexed = await readIndexedThumbnails(
        env.SEARCH_DB as SearchDb | undefined,
        [...new Set(pending.flatMap(candidatesOf))],
    );

    // Only the owner can see a private video placed ahead of the first public
    // one; every other viewer stops at the first indexed video.
    const toRead = new Set<string>();
    for (const playlist of pending) {
        const candidates = candidatesOf(playlist);
        const firstIndexed = candidates.findIndex((id) => indexed.has(id));
        const isOwner = !!userId && playlist.userId === userId;
        const missing = firstIndexed === -1 ? candidates : isOwner ? candidates.slice(0, firstIndexed) : [];
        for (const id of missing) toRead.add(id);
    }
    const stored = await readVideos(env.videos, [...toRead].slice(0, MAX_COVER_R2_READS));

    for (const playlist of pending) {
        for (const id of candidatesOf(playlist)) {
            const video = stored.get(id);
            const thumbnailUrl = stored.has(id)
                ? (video && canViewVideo(video, userId) ? video.thumbnailUrl : undefined)
                : indexed.get(id);
            if (thumbnailUrl) {
                covers.set(playlist.id as string, { videoId: id, thumbnailUrl });
                break;
            }
        }
    }

    logger.debug("[PlaylistCovers] Resolved covers", {
        playlists: pending.length,
        covers: covers.size,
        indexed: indexed.size,
        r2Reads: stored.size,
    });
    return covers;
}

/** Copies of `playlists` with `cover` set wherever one could be derived. */
export async function withPlaylistCovers<T extends PlaylistCoverSource>(
    env: PlaylistCoverEnv,
    playlists: T[],
    userId?: string | null,
): Promise<Array<T & { cover?: PlaylistCover }>> {
    const covers = await resolvePlaylistCovers(env, playlists, userId);
    return playlists.map((playlist) => {
        const cover = playlist.id ? covers.get(playlist.id) : undefined;
        return cover ? { ...playlist, cover } : playlist;
    });
}
