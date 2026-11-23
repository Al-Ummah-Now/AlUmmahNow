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

import { OWNERSHIP_TABLE, SEARCH_TABLES, type SearchDb } from "@al-ummah/shared-types";
import R2Repository from "./r2Repo";
import { logger } from "./logger";
import type { VideoType } from "./playlists";
import { canManagePlaylist, memoChannels } from "./channelAccess";
import { videoViewer } from "./videoViewer";
import { isOwnershipComplete, READY_SQL } from "./search/ownership";

export interface PlaylistCover {
    videoId: string;
    thumbnailUrl: string;
}

export interface PlaylistCoverSource {
    id?: string;
    userId?: string;
    channelId?: string | null;
    systemType?: unknown;
    thumbnailUrl?: string;
    videos?: string[];
    /** The managers' chosen cover video: tried first, while it is in the playlist */
    coverVideoId?: string;
}

export interface PlaylistCoverEnv {
    videos: R2Bucket;
    /** Who manages a channel's playlists and sees its private videos (signed-in viewers) */
    channels?: R2Bucket;
    SEARCH_DB?: unknown;
}

/** Videos considered per playlist before it falls back to the placeholder */
export const COVER_CANDIDATES = 5;
export const MAX_COVER_R2_READS = 24;
/** Upper bound on distinct R2 reads when resolving visible playlist counts without the ownership index */
export const MAX_COUNT_R2_READS = 200;
const COUNT_R2_CONCURRENCY = 25;
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

/** Per-request memo of R2 video reads so cover and visibility checks never read the same video twice. */
export type VideoReadCache = Map<string, Promise<VideoType | null>>;

async function readVideos(bucket: R2Bucket, ids: string[], cache?: VideoReadCache): Promise<Map<string, VideoType | null>> {
    const repository = new R2Repository<VideoType>(bucket);
    const entries = await Promise.all(ids.map(async (id) => {
        let pending = cache?.get(id);
        if (!pending) {
            pending = repository.getObject(id).catch(() => null);
            cache?.set(id, pending);
        }
        return [id, await pending] as const;
    }));
    return new Map(entries);
}

/** Covers keyed by playlist id, for the playlists that have no custom thumbnail. */
export async function resolvePlaylistCovers(
    env: PlaylistCoverEnv,
    playlists: PlaylistCoverSource[],
    userId?: string | null,
    cache?: VideoReadCache,
): Promise<Map<string, PlaylistCover>> {
    const pending = playlists.filter((playlist) => playlist.id && !playlist.thumbnailUrl && candidatesOf(playlist).length > 0);
    const covers = new Map<string, PlaylistCover>();
    if (pending.length === 0) return covers;

    const indexed = await readIndexedThumbnails(
        env.SEARCH_DB as SearchDb | undefined,
        [...new Set(pending.flatMap(candidatesOf))],
    );

    // Only those who manage the playlist can see a private video placed ahead of
    // the first public one; every other viewer stops at the first indexed video.
    const channels = memoChannels({ channels: env.channels });
    const sees = videoViewer(channels, userId);
    const toRead = new Set<string>();
    for (const playlist of pending) {
        const candidates = candidatesOf(playlist);
        const firstIndexed = candidates.findIndex((id) => indexed.has(id));
        // Asked only when a video sits ahead of the first public one
        const manages = firstIndexed > 0 && !!userId && await canManagePlaylist(channels, playlist, userId);
        const missing = firstIndexed === -1 ? candidates : manages ? candidates.slice(0, firstIndexed) : [];
        for (const id of missing) toRead.add(id);
    }
    const stored = await readVideos(env.videos, [...toRead].slice(0, MAX_COVER_R2_READS), cache);

    for (const playlist of pending) {
        for (const id of candidatesOf(playlist)) {
            const video = stored.get(id);
            const thumbnailUrl = stored.has(id)
                ? (video && await sees(video as never) ? video.thumbnailUrl : undefined)
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

/**
 * Subset of `videoIds` that `userId` may watch (using the playlist viewer rules):
 * excludes deleted, hidden, missing, scheduled, processing, and other users' private videos (#941).
 *
 * Uses primary-key lookups on content_ownership when the video index is complete.
 * Non-public videos require the live channel role check for signed-in viewers.
 * Returns null when neither source can safely answer (caller keeps the raw list).
 */
export async function resolveViewableVideoIds(
    env: Partial<PlaylistCoverEnv> | undefined,
    videoIds: readonly string[],
    userId?: string | null,
    cache?: VideoReadCache,
): Promise<Set<string> | null> {
    const unique = [...new Set(videoIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (unique.length === 0) return new Set();
    if (!env) return null;

    const visible = new Set<string>();
    let toRead = unique;
    const db = env.SEARCH_DB as SearchDb | undefined;
    if (db) {
        try {
            if (await isOwnershipComplete(db, "video")) {
                const nonPublic: string[] = [];
                const publicClause = `is_public = 1 AND ${READY_SQL}
                    AND (schedule_status IS NULL OR schedule_status NOT IN ('scheduled', 'publishing'))
                    AND (studio_status IS NULL OR studio_status NOT IN ('scheduled', 'drafts', 'in_review', 'not_approved'))`;
                for (let i = 0; i < unique.length; i += INDEX_CHUNK_SIZE) {
                    const chunk = unique.slice(i, i + INDEX_CHUNK_SIZE);
                    const { results } = await db
                        .prepare(
                            `SELECT id, (${publicClause}) AS public FROM ${OWNERSHIP_TABLE}
                             WHERE kind = 'video' AND id IN (${chunk.map(() => "?").join(",")})
                               AND is_deleted = 0 AND is_hidden = 0`,
                        )
                        .bind(...chunk)
                        .all<{ id: string; public: number }>();
                    for (const row of results ?? []) {
                        if (row.public) visible.add(row.id);
                        else if (userId) nonPublic.push(row.id);
                    }
                }
                toRead = nonPublic;
                if (!env.videos || toRead.length > MAX_COUNT_R2_READS) return visible;
            }
        } catch (error) {
            visible.clear();
            logger.warn("[PlaylistVideos] Ownership visibility lookup failed; falling back to R2", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    if (!env.videos || toRead.length > MAX_COUNT_R2_READS) return null;
    const sees = videoViewer({ channels: env.channels }, userId);
    for (let i = 0; i < toRead.length; i += COUNT_R2_CONCURRENCY) {
        const batch = toRead.slice(i, i + COUNT_R2_CONCURRENCY);
        const loaded = await readVideos(env.videos, batch, cache);
        await Promise.all(batch.map(async (id) => {
            if (await sees(loaded.get(id) as never)) visible.add(id);
        }));
    }
    return visible;
}

/**
 * Copies of `playlists` with `cover` set wherever one could be derived, and
 * `videos`/`videosCount` filtered to the videos `userId` can actually view (#941).
 */
export async function withPlaylistCovers<T extends PlaylistCoverSource>(
    env: PlaylistCoverEnv,
    playlists: T[],
    userId?: string | null,
): Promise<Array<T & { cover?: PlaylistCover }>> {
    const allIds = playlists.flatMap((playlist) => ("videosCount" in playlist && Array.isArray(playlist.videos) ? playlist.videos : []));
    const cache: VideoReadCache = new Map();
    const [covers, viewable] = await Promise.all([
        resolvePlaylistCovers(env, playlists, userId, cache),
        allIds.length > 0 ? resolveViewableVideoIds(env, allIds, userId, cache) : Promise.resolve(null),
    ]);
    return playlists.map((playlist) => {
        const cover = playlist.id ? covers.get(playlist.id) : undefined;
        let next: T & { cover?: PlaylistCover } = cover ? { ...playlist, cover } : playlist;
        if (viewable !== null && "videosCount" in playlist && Array.isArray(playlist.videos)) {
            const visible = playlist.videos.filter((id) => viewable.has(id));
            next = { ...next, videos: visible, videosCount: visible.length };
        }
        return next;
    });
}
