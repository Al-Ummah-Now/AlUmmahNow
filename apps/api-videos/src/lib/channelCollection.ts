/**
 * One Bunny Stream collection per channel, per library (SCALABILITY-AUDIT
 * AV-5; 2026-11-12 owner request: each channel's videos grouped in Bunny).
 *
 * A collection id belongs to one library, so the channel stores one id per
 * library: `bunnyCollections: { [libraryId]: collectionId }`. The older single
 * `bunnyCollectionId` (library not recorded) is adopted by the first library
 * that actually holds it (checked with the Bunny API) and is kept on the record
 * for older readers.
 *
 * - Created lazily on the channel's first upload to that library.
 * - Renamed with the channel (renameChannelCollections).
 * - A soft-deleted channel keeps them; purge removes them (deleteChannelCollections).
 *
 * Parallel first uploads to a channel without a collection each create one;
 * only the first to store its id in the channel JSON (conditional write)
 * keeps it. The others delete the collection they created and use the
 * stored one, so the channel's videos never split across collections.
 */
import R2Repository from './r2Repo';
import { logger } from './logger';
import { bunnyClient, bunnyLibraries, type BunnyLibrariesEnv } from './bunny/libraries';

export interface CollectionClient {
	createCollection(libraryId: number, data: { name?: string }): Promise<{ guid?: string | null }>;
	deleteCollection(libraryId: number, collectionId: string): Promise<void>;
	getCollection?(libraryId: number, collectionId: string): Promise<{ guid?: string | null }>;
	updateCollection?(libraryId: number, collectionId: string, data: { name?: string }): Promise<unknown>;
}

export interface CollectionChannel {
	name?: string;
	bunnyCollectionId?: string | null;
	bunnyCollections?: Record<string, string> | null;
	dateModified?: string;
}

/** The channel's collection id in `libraryId`, from the per-library map only */
export function storedCollectionId(channel: CollectionChannel | null | undefined, libraryId: number): string | undefined {
	return channel?.bunnyCollections?.[String(libraryId)] || undefined;
}

/** Every (library, collection) pair the channel holds, including an unadopted legacy id (library unknown: null) */
export function channelCollections(channel: CollectionChannel | null | undefined): { libraryId: number | null; collectionId: string }[] {
	const out: { libraryId: number | null; collectionId: string }[] = [];
	const map = channel?.bunnyCollections ?? {};
	for (const [lib, id] of Object.entries(map)) if (id) out.push({ libraryId: Number(lib), collectionId: id });
	const legacy = channel?.bunnyCollectionId;
	if (legacy && !Object.values(map).includes(legacy)) out.push({ libraryId: null, collectionId: legacy });
	return out;
}

/** Store `collectionId` for `libraryId` unless the channel already has one there; returns the stored id */
async function storeCollection<C extends CollectionChannel>(
	channels: R2Repository<C>,
	channelId: string,
	libraryId: number,
	collectionId: string,
): Promise<string | undefined> {
	const key = String(libraryId);
	const stored = await channels.updateObject(channelId, (fresh) => {
		if (fresh.bunnyCollections?.[key]) return false;
		fresh.bunnyCollections = { ...(fresh.bunnyCollections ?? {}), [key]: collectionId };
		fresh.dateModified = new Date().toISOString();
		return true;
	});
	return storedCollectionId(stored, libraryId);
}

/**
 * Adopt the channel's legacy single `bunnyCollectionId` for `libraryId` when
 * that library holds it. Returns the adopted id, or undefined (not there, or
 * the client cannot check).
 */
export async function adoptLegacyCollection<C extends CollectionChannel>(
	channels: R2Repository<C>,
	bunny: CollectionClient,
	libraryId: number,
	channelId: string,
	channel: CollectionChannel,
): Promise<string | undefined> {
	const legacy = channel.bunnyCollectionId;
	if (!legacy || !bunny.getCollection) return undefined;
	// Already adopted by another library: a collection lives in one library only
	if (Object.values(channel.bunnyCollections ?? {}).includes(legacy)) return undefined;
	try {
		const found = await bunny.getCollection(libraryId, legacy);
		if (!found?.guid) return undefined;
	} catch {
		return undefined;
	}
	return storeCollection(channels, channelId, libraryId, legacy);
}

/** Resolves to the channel's collection id in `libraryId` (stored, adopted, or created by this call or a parallel one). */
export async function ensureChannelCollection<C extends CollectionChannel>(
	channels: R2Repository<C>,
	bunny: CollectionClient,
	libraryId: number,
	channelId: string,
	name: string,
): Promise<string | undefined> {
	const current = await channels.getObject(channelId);
	const existing = storedCollectionId(current, libraryId);
	if (existing) return existing;
	if (current) {
		const adopted = await adoptLegacyCollection(channels, bunny, libraryId, channelId, current);
		if (adopted) return adopted;
	}

	const collection = await bunny.createCollection(libraryId, { name });
	const created = collection.guid || undefined;
	if (!created) return undefined;
	const kept = await storeCollection(channels, channelId, libraryId, created);
	if (kept !== created) {
		logger.debug('[ChannelCollection] Another upload created the collection first; removing ours', { channelId, libraryId, ours: created, stored: kept });
		await bunny.deleteCollection(libraryId, created).catch((error) => {
			logger.warn('[ChannelCollection] Could not delete the duplicate collection', {
				channelId,
				libraryId,
				collectionId: created,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}
	return kept;
}

/** Client per library (each library has its own API key) */
export type ClientFor = (libraryId: number) => Promise<CollectionClient | undefined>;

/**
 * Rename the channel's collections in every library after a channel rename.
 * Best effort: a failure is logged and never fails the rename.
 */
export async function renameChannelCollections(clientFor: ClientFor, channelId: string, channel: CollectionChannel, name: string): Promise<number> {
	let renamed = 0;
	for (const { libraryId, collectionId } of channelCollections(channel)) {
		if (libraryId === null) continue; // unadopted legacy id: library unknown; the backfill adopts it
		try {
			const client = await clientFor(libraryId);
			if (!client?.updateCollection) continue;
			await client.updateCollection(libraryId, collectionId, { name });
			renamed++;
		} catch (error) {
			logger.warn('[ChannelCollection] Could not rename the collection', {
				channelId,
				libraryId,
				collectionId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return renamed;
}

/**
 * Remove the channel's collections when the channel is purged (soft delete
 * keeps them). Videos are not deleted by removing their collection.
 * An unadopted legacy id is tried in every library given.
 */
export async function deleteChannelCollections(
	clientFor: ClientFor,
	libraryIds: number[],
	channelId: string,
	channel: CollectionChannel,
): Promise<number> {
	let deleted = 0;
	for (const { libraryId, collectionId } of channelCollections(channel)) {
		const targets = libraryId === null ? libraryIds : [libraryId];
		for (const lib of targets) {
			try {
				const client = await clientFor(lib);
				if (!client) continue;
				await client.deleteCollection(lib, collectionId);
				deleted++;
				break;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (libraryId === null && /\b404\b/.test(message)) continue;
				logger.warn('[ChannelCollection] Could not delete the collection', { channelId, libraryId: lib, collectionId, error: message });
			}
		}
	}
	return deleted;
}

/**
 * The channel's collection in `libraryId` for a new upload: undefined for a
 * user-level upload (no channel), a missing channel or on failure (the video
 * is then created outside any collection; the backfill places it later).
 */
export async function uploadCollection(
	env: { channels: R2Bucket },
	bunny: CollectionClient,
	libraryId: number,
	channelId: string,
	userId: string,
): Promise<string | undefined> {
	if (channelId === userId) return undefined;
	const channels = new R2Repository<CollectionChannel>(env.channels);
	try {
		const channel = await channels.getObject(channelId);
		if (!channel) {
			logger.debug('[ChannelCollection] Channel not found, upload goes without a collection', { channelId, userId });
			return undefined;
		}
		const existing = storedCollectionId(channel, libraryId);
		if (existing) return existing;
		const collectionId = await ensureChannelCollection(channels, bunny, libraryId, channelId, channel.name || `Channel ${channelId}`);
		logger.debug('[ChannelCollection] Collection ready for upload', { channelId, libraryId, collectionId });
		return collectionId;
	} catch (error) {
		logger.error('[ChannelCollection] Failed to get or create the collection', {
			channelId,
			libraryId,
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

/**
 * After a channel rename: rename its collection in every library this env
 * knows (each with that library's API key). Best effort, never throws.
 */
export async function renameCollectionsForChannel(env: BunnyLibrariesEnv, channelId: string, channel: CollectionChannel | null | undefined): Promise<number> {
	if (!channel?.name || channelCollections(channel).length === 0) return 0;
	try {
		const libraries = await bunnyLibraries(env);
		const clientFor: ClientFor = async (libraryId) => {
			const library = libraries.find((l) => l.libraryId === libraryId);
			return library?.apiKey ? bunnyClient(env, library).client : undefined;
		};
		return await renameChannelCollections(clientFor, channelId, channel, channel.name);
	} catch (error) {
		logger.warn('[ChannelCollection] Rename skipped', { channelId, error: error instanceof Error ? error.message : String(error) });
		return 0;
	}
}
