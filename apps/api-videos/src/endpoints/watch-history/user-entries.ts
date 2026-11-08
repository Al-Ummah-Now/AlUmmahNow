import R2Repository from "../../lib/r2Repo";
import type { WatchHistoryEntry } from "@al-ummah/shared-types";

const PAGE_SIZE = 500;
const MAX_PAGES = 10;

/**
 * Load every watch history entry of a user.
 * Entries are keyed `${userId}:${videoId}`, so an R2 prefix listing returns
 * only this user's entries regardless of how many other users exist.
 */
export async function listUserWatchHistory(
  bucket: R2Bucket,
  userId: string
): Promise<WatchHistoryEntry[]> {
  const repo = new R2Repository<WatchHistoryEntry>(bucket);
  const entries: WatchHistoryEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await repo.listObjects(PAGE_SIZE, cursor, `${userId}:`);
    entries.push(...result.items.filter((entry) => entry && entry.userId === userId));
    if (!result.cursor) break;
    cursor = result.cursor;
  }
  return entries;
}
