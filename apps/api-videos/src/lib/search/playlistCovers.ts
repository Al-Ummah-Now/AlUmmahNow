import type { SearchResultItem } from "@al-ummah/shared-types";
import { resolvePlaylistCovers, type PlaylistCoverEnv } from "../playlistCovers";

/**
 * Adds `cover` to playlist search results and removes the internal
 * `coverVideoIds`. Search responses are publicly cacheable, so covers are
 * always resolved as an anonymous viewer.
 */
export async function attachSearchPlaylistCovers(env: PlaylistCoverEnv, results: SearchResultItem[]): Promise<void> {
  const items = results.flatMap((item) => (item.type === "playlist" ? [item.playlist] : []));
  if (items.length === 0) return;

  const covers = await resolvePlaylistCovers(
    env,
    items.map((playlist) => ({ id: playlist.id, thumbnailUrl: playlist.thumbnailUrl, videos: playlist.coverVideoIds })),
    null,
  );
  for (const playlist of items) {
    delete playlist.coverVideoIds;
    const cover = covers.get(playlist.id);
    if (cover) playlist.cover = cover;
  }
}
