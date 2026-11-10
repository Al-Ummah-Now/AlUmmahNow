/**
 * Edge cache of a channel's populated sections for signed-out visitors
 * (docs/specs/CHANNEL-SECTIONS.md §8.4). Signed-in requests never use it,
 * because editors also get empty sections and hints.
 */
import { deleteEdgeCache, edgeCacheUrl } from './edge-cache';

export const SECTIONS_CACHE_TTL_SECONDS = 60;

export function sectionsCacheUrl(requestUrl: string, channelId: string): string {
  return edgeCacheUrl(requestUrl, `channel-sections/${encodeURIComponent(channelId)}/populated`);
}

type WaitUntil = ((promise: Promise<unknown>) => void) | null;

/** After any section write: this colo serves the change at once, others within the TTL */
export function purgeSectionsCache(requestUrl: string, channelId: string, waitUntil: WaitUntil): void {
  deleteEdgeCache(sectionsCacheUrl(requestUrl, channelId), waitUntil);
}
