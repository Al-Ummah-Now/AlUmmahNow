/**
 * Pure helpers for playlist UI.
 */

/** Watch page URL for a video (matches VideoCard links). */
export function getWatchHref(locale: string, videoId: string): string {
  return `/${locale}/video?vid=${encodeURIComponent(videoId)}`;
}

/** Playlist page URL. */
export function getPlaylistHref(locale: string, playlistId: string): string {
  return `/${locale}/playlist/${encodeURIComponent(playlistId)}`;
}

/**
 * "Play all" target: the first playable video in playlist order, or null
 * when the playlist has no viewable videos.
 */
export function getPlayAllHref(locale: string, videos: Array<{ id: string }>): string | null {
  const first = videos.find((video) => !!video?.id);
  return first ? getWatchHref(locale, first.id) : null;
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

/** Validate a playlist title from a form. Returns the trimmed title or null. */
export function normalizePlaylistTitle(input: string, maxLength = 150): string | null {
  const title = input.trim().replace(/\s+/g, ' ');
  if (!title) return null;
  return title.slice(0, maxLength);
}
