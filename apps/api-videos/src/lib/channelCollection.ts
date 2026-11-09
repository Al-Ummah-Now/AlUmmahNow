/**
 * One Bunny Stream collection per channel (SCALABILITY-AUDIT AV-5).
 *
 * Parallel first uploads to a channel without a collection each create one;
 * only the first to store its id in the channel JSON (conditional write)
 * keeps it. The others delete the collection they created and use the
 * stored one, so the channel's videos never split across collections.
 */
import type R2Repository from './r2Repo';
import { logger } from './logger';

export interface CollectionClient {
	createCollection(libraryId: number, data: { name?: string }): Promise<{ guid?: string | null }>;
	deleteCollection(libraryId: number, collectionId: string): Promise<void>;
}

/** Resolves to the channel's collection id (existing, or created by this call or a parallel one). */
export async function ensureChannelCollection<C extends { bunnyCollectionId?: string | null; dateModified?: string }>(
	channels: R2Repository<C>,
	bunny: CollectionClient,
	libraryId: number,
	channelId: string,
	name: string,
): Promise<string | undefined> {
	const collection = await bunny.createCollection(libraryId, { name });
	const created = collection.guid || undefined;
	if (!created) return undefined;
	const stored = await channels.updateObject(channelId, (fresh) => {
		if (fresh.bunnyCollectionId) return false;
		fresh.bunnyCollectionId = created;
		fresh.dateModified = new Date().toISOString();
		return true;
	});
	const kept = stored?.bunnyCollectionId || undefined;
	if (kept !== created) {
		logger.info('[ChannelCollection] Another upload created the collection first; removing ours', { channelId, ours: created, stored: kept });
		await bunny.deleteCollection(libraryId, created).catch((error) => {
			logger.warn('[ChannelCollection] Could not delete the duplicate collection', {
				channelId,
				collectionId: created,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}
	return kept;
}
