import type { SearchResultItem } from "@al-ummah/shared-types";
import { logger } from "../logger";
import { channelVideoCountsFromIndex, type OwnershipEnv } from "./ownership";

/**
 * Sets `videosCount` on channel cards (search results, Explore's new channels) from the ownership
 * index, the count the channel page shows. The search payload keeps the count from when the channel
 * was indexed, which uploads never refresh, so a channel with videos read "No videos" (#1669
 * audit). The indexed payload's count stays when the index is not complete or fails.
 */
export async function attachLiveChannelVideoCounts(env: OwnershipEnv, channels: Array<{ id: string; videosCount?: number }>): Promise<void> {
  if (channels.length === 0) return;
  try {
    const counts = await channelVideoCountsFromIndex(env, channels.map((channel) => channel.id));
    if (!counts) return;
    for (const channel of channels) {
      const count = counts.get(channel.id);
      if (count !== undefined) channel.videosCount = count;
    }
  } catch (error) {
    logger.warn("[Search] Live channel video counts failed; indexed counts kept", { error: error instanceof Error ? error.message : String(error) });
  }
}

/** The channel results of a search response */
export function channelCards(results: SearchResultItem[]): Array<{ id: string; videosCount?: number }> {
  return results.flatMap((item) => (item.type === "channel" ? [item.channel as { id: string; videosCount?: number }] : []));
}
