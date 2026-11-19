/**
 * Channel subscriber counts in the search index (#1633).
 *
 * Subscriptions live in D1 (NOTIFICATIONS_DB: channel_subscriber_counts, one row per channel,
 * SCALABILITY-AUDIT AV-4), so subscribing never writes the R2 channel object the search document
 * is built from. Two things keep the index's count (Explore, search results, suggestions and the
 * channel's popularity) in step:
 * - every channel document write passes the live count (syncSearchDocument `subscribers`), read
 *   here by primary key;
 * - a subscription change refreshes the indexed row's count and popularity (processor, on the
 *   Subscribe/Unsubscribe message): one primary-key read and one UPDATE of the base row, like any
 *   other counter change; the full-text entry is untouched.
 */
import { SEARCH_TABLES, channelPopularity } from './documents';
import type { SearchDb } from './store';

/** The read side of a D1 binding: enough for one primary-key lookup. */
export interface SubscriberCountDb {
  prepare(sql: string): { bind(...values: unknown[]): { first<T = Record<string, unknown>>(): Promise<T | null> } };
}

/**
 * The live subscriber count of a channel, or undefined when D1 has no row for it yet (never
 * subscribed to, or its legacy subscriptions are not imported yet): the caller then keeps the
 * count stored on the channel.
 */
export async function channelSubscriberCount(db: SubscriberCountDb | null | undefined, channelId: string): Promise<number | undefined> {
  if (!db || !channelId) return undefined;
  const row = await db
    .prepare('SELECT subscribers FROM channel_subscriber_counts WHERE channel_id = ?1')
    .bind(channelId)
    .first<{ subscribers: number | null }>();
  if (!row) return undefined;
  return Math.max(0, Math.floor(Number(row.subscribers) || 0));
}

export type ChannelSubscribersRefresh = 'updated' | 'unchanged' | 'missing';

/**
 * Set an indexed channel's subscriber count and popularity. `missing` when the channel has no
 * indexed row (not indexed yet, or deleted: its payload is '{}'); its next write carries the count.
 */
export async function refreshChannelSubscribers(db: SearchDb, channelId: string, subscribers: number): Promise<ChannelSubscribersRefresh> {
  const { base } = SEARCH_TABLES.channel;
  const row = await db.prepare(`SELECT payload FROM ${base} WHERE id = ?`).bind(channelId).first<{ payload: string | null }>();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = row?.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : null;
  } catch {
    payload = null;
  }
  if (!payload || payload.id === undefined) return 'missing';
  const count = Math.max(0, Math.floor(Number(subscribers) || 0));
  if (payload.subscribersCount === count) return 'unchanged';
  payload.subscribersCount = count;
  const videos = Math.max(0, Number(payload.videosCount) || 0);
  await db
    .prepare(`UPDATE ${base} SET payload = ?, popularity = ? WHERE id = ?`)
    .bind(JSON.stringify(payload), channelPopularity(count, videos), channelId)
    .run();
  return 'updated';
}
