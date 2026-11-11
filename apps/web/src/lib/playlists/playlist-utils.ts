/**
 * Pure helpers for playlist UI.
 */
import { watchHref } from './playback';

/** Watch page URL for a video, inside a list when one is given (docs/specs/PLAYLIST-PLAYBACK.md). */
export function getWatchHref(locale: string, videoId: string, list?: { id: string; index: number } | null): string {
  return watchHref(locale, videoId, list ? { list: list.id, index: list.index } : {});
}

/**
 * "Play all" from a card that has no video list: the playlist page with `?play=1`, which goes on
 * to the first video this viewer may watch, played as the list.
 */
export function getPlayAllEntryHref(locale: string, playlistId: string): string {
  return `${getPlaylistHref(locale, playlistId)}?play=1`;
}

/** Playlist page URL. */
export function getPlaylistHref(locale: string, playlistId: string): string {
  return `/${locale}/playlist/${encodeURIComponent(playlistId)}`;
}

/** A video's place in the stored list (the URL index), falling back to its place in the shown list. */
export function storedIndexOf(storedIds: readonly string[] | null | undefined, videoId: string, shownIndex: number): number {
  const at = storedIds ? storedIds.indexOf(videoId) : -1;
  return at >= 0 ? at : shownIndex;
}

/**
 * "Play all" target: the first playable video in playlist order, played as
 * the list (`?list=&index=`), or null when the playlist has no viewable videos.
 */
export function getPlayAllHref(
  locale: string,
  videos: Array<{ id: string }>,
  listId: string,
  storedIds?: readonly string[] | null,
): string | null {
  const at = videos.findIndex((video) => !!video?.id);
  if (at === -1) return null;
  const first = videos[at];
  return getWatchHref(locale, first.id, { id: listId, index: storedIndexOf(storedIds, first.id, at) });
}

/**
 * Return a copy of `items` with the element at `from` moved to `to`.
 * Out-of-range indices return an unchanged copy.
 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const copy = items.slice();
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length || from === to) {
    return copy;
  }
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** Format seconds as M:SS or H:MM:SS (empty string when unknown). */
export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Display name of a playlist. The API stores `title`; some endpoints add a
 * `name` alias and others (GET /api/channels/{id}/playlists) do not.
 */
export function getPlaylistDisplayName(playlist: { name?: string | null; title?: string | null }): string {
  return playlist.name || playlist.title || '';
}

/** Number of videos: the stored counter when present, else the ordered id list. */
export function getPlaylistVideoCount(playlist: { videosCount?: number | null; videos?: unknown }): number {
  if (typeof playlist.videosCount === 'number') return playlist.videosCount;
  return Array.isArray(playlist.videos) ? playlist.videos.length : 0;
}

export interface PlaylistCoverFields {
  thumbnailUrl?: string | null;
  cover?: { thumbnailUrl?: string | null } | null;
}

/**
 * Image to show for a playlist: the custom thumbnail, then the API-derived
 * cover, then the first loaded video that has a thumbnail. Null means the
 * placeholder should be shown.
 */
export function getPlaylistCoverUrl(
  playlist: PlaylistCoverFields,
  videos?: Array<{ thumbnailUrl?: string | null }>
): string | null {
  return (
    playlist.thumbnailUrl ||
    playlist.cover?.thumbnailUrl ||
    videos?.find((video) => video?.thumbnailUrl)?.thumbnailUrl ||
    null
  );
}

/** Validate a playlist title from a form. Returns the trimmed title or null. */
export function normalizePlaylistTitle(input: string, maxLength = 150): string | null {
  const title = input.trim().replace(/\s+/g, ' ');
  if (!title) return null;
  return title.slice(0, maxLength);
}
