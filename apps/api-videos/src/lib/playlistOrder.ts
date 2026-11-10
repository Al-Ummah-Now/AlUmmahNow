/**
 * Playlist order (manual, or automatic by a field and direction; shared-types
 * playlist-bulk.ts). The server applies it everywhere a playlist's videos are
 * listed, so every client sees one order and pages cut after sorting.
 *
 * The order is also materialized into the stored `videos` array: every write
 * re-sorts it, and a read that sorted from fresh video data (views change)
 * writes the new order back when it differs. Readers that only use the ids
 * (lists, covers, channel Playlists tab) therefore follow the same order.
 */
import { playlistSortOf, sortPlaylistVideoIds, type PlaylistSort, type PlaylistSortVideo } from '@al-ummah/shared-types';
import R2Repository from './r2Repo';
import { logger } from './logger';
import type { PlaylistType, VideoType } from './playlists';

/** Object reads run at once. */
const READ_CONCURRENCY = 25;

/** Loads the given videos (missing or unreadable ones are absent from the map). */
export async function loadPlaylistVideos(env: { videos: R2Bucket }, ids: readonly string[]): Promise<Map<string, VideoType>> {
	const repo = new R2Repository<VideoType>(env.videos);
	const map = new Map<string, VideoType>();
	for (let i = 0; i < ids.length; i += READ_CONCURRENCY) {
		const batch = ids.slice(i, i + READ_CONCURRENCY);
		const loaded = await Promise.all(batch.map((id) => repo.getObject(id).catch(() => null)));
		batch.forEach((id, j) => {
			const video = loaded[j];
			if (video) map.set(id, video);
		});
	}
	return map;
}

/** The fields the sort reads; removed videos count as having no values (they sort last). */
export function sortVideoOf(videos: ReadonlyMap<string, VideoType>) {
	return (id: string): PlaylistSortVideo | null => {
		const video = videos.get(id);
		if (!video || video.isDeleted || video.isHidden) return null;
		const extra = video as VideoType & { publishedAt?: string };
		return { title: video.title, publishedAt: extra.publishedAt ?? null, dateCreated: video.dateCreated, views: video.views, duration: video.duration ?? null };
	};
}

/** The playlist's ids in its order, sorted with `sort` (default: its own). */
export function orderOf(playlist: Pick<PlaylistType, 'videos'> & { videoAddedAt?: Record<string, string> }, videos: ReadonlyMap<string, VideoType>, sort: PlaylistSort): string[] {
	return sortPlaylistVideoIds(playlist.videos || [], sort, sortVideoOf(videos), playlist.videoAddedAt ?? {});
}

const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The playlist's ids in order, with the videos loaded for an automatic sort
 * (empty map for manual: nothing to read).
 */
export async function orderedPlaylist(env: { videos: R2Bucket }, playlist: PlaylistType): Promise<{ ids: string[]; videos: Map<string, VideoType>; sort: PlaylistSort }> {
	const sort = playlistSortOf(playlist);
	if (sort.sortMode !== 'auto') return { ids: [...(playlist.videos || [])], videos: new Map(), sort };
	const videos = await loadPlaylistVideos(env, playlist.videos || []);
	return { ids: orderOf(playlist, videos, sort), videos, sort };
}

/**
 * Writes the automatic order into the stored `videos` when it changed (a
 * conditional write re-sorting the fresh record; a concurrent add keeps its
 * id). No-op for manual playlists. Returns the stored order.
 */
export async function persistAutoOrder(env: { playlists: R2Bucket; videos: R2Bucket }, playlistId: string, known?: Map<string, VideoType>): Promise<string[] | null> {
	const repo = new R2Repository<PlaylistType>(env.playlists);
	const current = await repo.getObject(playlistId);
	if (!current || playlistSortOf(current).sortMode !== 'auto') return current ? current.videos || [] : null;
	const videos = known ?? new Map();
	const missing = (current.videos || []).filter((id) => !videos.has(id));
	if (missing.length) for (const [id, video] of await loadPlaylistVideos(env, missing)) videos.set(id, video);
	const stored = await repo.updateObject(playlistId, (fresh) => {
		const sort = playlistSortOf(fresh);
		if (sort.sortMode !== 'auto') return false;
		const next = orderOf(fresh, videos, sort);
		if (sameOrder(next, fresh.videos || [])) return false;
		fresh.videos = next;
		return true;
	});
	return stored ? stored.videos || [] : null;
}

/** After a read sorted from fresh data: store the order in the background when it differs. */
export function refreshStoredOrder(
	env: { playlists: R2Bucket; videos: R2Bucket },
	playlist: PlaylistType,
	ordered: readonly string[],
	videos: Map<string, VideoType>,
	waitUntil: ((p: Promise<unknown>) => void) | null,
): void {
	if (playlistSortOf(playlist).sortMode !== 'auto' || sameOrder(ordered, playlist.videos || [])) return;
	const task = persistAutoOrder(env, playlist.id, videos).catch((error) => {
		logger.warn('[PlaylistOrder] Could not store the refreshed order', { playlistId: playlist.id, error: error instanceof Error ? error.message : String(error) });
	});
	if (waitUntil) waitUntil(task);
}
