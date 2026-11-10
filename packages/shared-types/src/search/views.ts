/**
 * View counts in the indexes between object writes.
 *
 * The view counter (websocket-server view-counter.ts) writes `views` into the
 * video JSON in R2 itself, so those writes never pass through api-videos'
 * index sync: content_ownership.views (channel totals, popular sorts) and
 * search_videos.views / popularity (search ranking, popular and trending
 * sections) kept the count of the video's last edit. After each flush the
 * counter calls syncVideoViews, one read and one batch per flush (a flush
 * happens at most every 10 s per shard, so this is already batched).
 *
 * Counts only rise: a replayed or late call never lowers a newer count, and
 * an object write (which reads views from R2) never lowers one either
 * (ownershipUpsertStatement keeps the larger count).
 */

import type { SearchDb } from './store';
import { OWNERSHIP_TABLE } from './ownership';

function log10p(n: number): number {
  return Math.log10(1 + Math.max(n, 0));
}

/** Same rounding as the search projection (documents.ts). */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Raise the video's views in both indexes to `views` (no-op where they are
 * already as high) and stamp search_videos.activity_at (trending candidates).
 * Popularity moves by the views term of its formula (0.3 × log10(1 + views)),
 * so the likes term stays as last projected. Throws when D1 fails; the
 * caller retries.
 */
export async function syncVideoViews(db: SearchDb, videoId: string, views: number, now = Date.now()): Promise<{ search: boolean }> {
  const count = Math.max(0, Math.floor(views));
  const row = await db.prepare('SELECT views, popularity FROM search_videos WHERE id = ?').bind(videoId).first<{ views: number; popularity: number }>();
  const statements = [
    db.prepare(`UPDATE ${OWNERSHIP_TABLE} SET views = ? WHERE kind = 'video' AND id = ? AND views < ?`).bind(count, videoId, count),
  ];
  const before = Number(row?.views ?? 0);
  const raise = !!row && count > before;
  if (raise) {
    const popularity = round(Number(row!.popularity ?? 0) + 0.3 * (log10p(count) - log10p(before)));
    statements.push(
      db.prepare(
        `UPDATE search_videos SET views = ?, popularity = ?, activity_at = ?, payload = json_set(payload, '$.views', ?)
         WHERE id = ? AND views = ?`,
      ).bind(count, popularity, now, count, videoId, before),
    );
  }
  await db.batch(statements);
  return { search: raise };
}
