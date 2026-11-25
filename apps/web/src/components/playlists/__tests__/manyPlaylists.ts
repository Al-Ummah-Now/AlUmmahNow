/**
 * A user (or channel) with more playlists than one page, for the picker tests:
 * a listPlaylists mock that pages with the cursor (the next offset) and
 * filters by `q` the way the API does.
 */
import type { PlaylistWithVideos } from '@/lib/api/playlists';

export const MANY = 160;

export function manyPlaylists(prefix: string, channelId = '', count = MANY): PlaylistWithVideos[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    name: `${prefix} ${i + 1}`,
    title: `${prefix} ${i + 1}`,
    channelId,
    isPublic: true,
    videos: [],
  })) as unknown as PlaylistWithVideos[];
}

/** `serverPage` caps a page below what is asked (a cursor API may answer fewer), so a rendering test can page with few rows */
export function pagedList(all: PlaylistWithVideos[], serverPage = Infinity) {
  return async (params?: { limit?: number; cursor?: string; q?: string }) => {
    const q = params?.q?.trim().toLowerCase();
    const matches = q ? all.filter((p) => String(p.title).toLowerCase().includes(q)) : all;
    const offset = Number(params?.cursor || 0);
    const limit = Math.min(params?.limit ?? 10, serverPage);
    const data = matches.slice(offset, offset + limit);
    const next = offset + data.length;
    return { data, cursor: next < matches.length ? String(next) : '', limit } as never;
  };
}
