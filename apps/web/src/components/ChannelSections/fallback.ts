import type { VideoObject } from '@al-ummah/shared-types';
import { getChannelPlaylists, getChannelShorts, getChannelVideos } from '@/lib/api/channels';
import { withinBudget } from '@/lib/ssr/first-data';
import type { ChannelHomeFallback, SectionPlaylist } from './sectionData';

/** How many items each fallback shelf shows */
export const FALLBACK_SHELF_SIZE = 12;

const items = <T,>(page: { data?: T[] | null } | null | undefined): T[] => page?.data ?? [];

/** The channel's public playlists for the fallback; the Home tab looks the same to everyone (owner, 2026-11-10) */
export async function loadFallbackPlaylists(channelId: string): Promise<SectionPlaylist[]> {
  const page = await getChannelPlaylists(channelId, { limit: FALLBACK_SHELF_SIZE });
  return (items(page) as unknown as SectionPlaylist[]).filter((p) => (p as { isPublic?: boolean }).isPublic !== false);
}

/**
 * A channel's latest videos, Shorts and public playlists for a Home tab without sections (#1206),
 * read through the same calls as the Videos, Shorts and Playlists tabs (as the viewer). A list that
 * fails is empty: the others still show. With `budgetMs` (the server) each list is bounded on its
 * own: late playlists are left out (`undefined`, loaded on the client), and late videos or Shorts make
 * the whole fallback null, so the client loads it all.
 */
export async function loadChannelHomeFallback(channelId: string): Promise<ChannelHomeFallback>;
export async function loadChannelHomeFallback(channelId: string, budgetMs: number): Promise<ChannelHomeFallback | null>;
export async function loadChannelHomeFallback(channelId: string, budgetMs?: number): Promise<ChannelHomeFallback | null> {
  const bounded = async <T,>(load: () => Promise<T>, empty: T): Promise<T | undefined> =>
    budgetMs ? withinBudget(load, budgetMs) : load().catch(() => empty);
  const [videos, shorts, playlists] = await Promise.all([
    bounded(async () => items<VideoObject>(await getChannelVideos(channelId, { limit: FALLBACK_SHELF_SIZE })), []),
    bounded(async () => items<VideoObject>(await getChannelShorts(channelId, { limit: FALLBACK_SHELF_SIZE })), []),
    bounded(() => loadFallbackPlaylists(channelId), []),
  ]);
  if (!videos || !shorts) return null;
  return { videos, shorts, ...(playlists ? { playlists } : {}) };
}
