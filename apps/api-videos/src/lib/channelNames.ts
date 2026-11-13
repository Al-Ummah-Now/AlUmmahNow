/**
 * Channel names for items that carry only a channel id (or the default name copied at upload):
 * each distinct channel is read once from the channels bucket and every item gets `channelName`
 * and `channelNameLocalized` (lib/channelName.ts), so pages show the name in their own language.
 */
import R2Repository from './r2Repo';
import { logger } from './logger';
import { channelNameFields, type ChannelNameFields, type NamedChannel } from './channelName';

/** Names per channel id; a channel that is missing or unreadable has no entry. */
export async function channelNamesByIds(channels: R2Bucket | undefined, ids: Iterable<string | null | undefined>): Promise<Map<string, ChannelNameFields>> {
  const out = new Map<string, ChannelNameFields>();
  const unique = [...new Set([...ids].filter((id): id is string => !!id))];
  if (!channels || unique.length === 0) return out;
  const repo = new R2Repository<NamedChannel>(channels);
  await Promise.all(
    unique.map(async (id) => {
      try {
        const channel = await repo.getObject(id);
        if (channel) out.set(id, channelNameFields(channel));
      } catch (error) {
        logger.warn('[ChannelNames] Channel read failed', { channelId: id, error: error instanceof Error ? error.message : String(error) });
      }
    }),
  );
  return out;
}

/** The items with their channel's names (an item whose channel is unknown keeps its own `channelName`). */
export async function withChannelNames<T extends { channelId?: string | null; channelName?: string }>(
  channels: R2Bucket | undefined,
  items: T[],
): Promise<Array<T & Partial<ChannelNameFields>>> {
  const names = await channelNamesByIds(channels, items.map((item) => item.channelId));
  return items.map((item) => {
    const named = item.channelId ? names.get(item.channelId) : undefined;
    return named ? { ...item, ...named } : item;
  });
}
