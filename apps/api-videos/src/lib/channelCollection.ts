/**
 * One Bunny Stream collection per channel, per library (SCALABILITY-AUDIT
 * AV-5; 2026-11-12 owner request: each channel's videos grouped in Bunny),
 * and one per user for user-level uploads (stored on the profile the same way).
 *
 * A collection id belongs to one library, so the channel stores one id per
 * library: `bunnyCollections: { [libraryId]: collectionId }`. The older single
 * `bunnyCollectionId` (library not recorded) is adopted by the first library
 * that actually holds it (checked with the Bunny API) and is kept on the record
 * for older readers.
 *
 * - Created lazily on the first upload to that library (uploadCollection).
 * - Renamed with the channel or profile (renameCollectionsFor).
 * - Soft delete keeps them; purge, erasure and the owner's channel delete
 *   (which removes the record) remove them (removeCollectionsFor).
 *
 * Parallel first uploads to a channel without a collection each create one;
 * only the first to store its id in the channel JSON (conditional write)
 * keeps it. The others delete the collection they created and use the
 * stored one, so the channel's videos never split across collections.
 */
import { bunnyRef } from './media/providers';
import R2Repository from './r2Repo';
import { logger } from './logger';
import { bunnyClient, bunnyLibraries, bunnyLibraryForVideo, type BunnyLibrariesEnv, type LibraryHints } from './bunny/libraries';
import { resolveDisplayName, type NameFields } from '@al-ummah/shared-types';

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

/** Profile fields a user collection is named after */
export interface CollectionProfile extends CollectionChannel, NameFields {
	displayName?: string;
	userName?: string;
}

/**
 * Name of a user's Bunny collection (an internal storage label): the resolved
 * display name (display name, else first + last), else the stored legacy
 * userName as before, else the user id
 */
export function userCollectionName(profile: CollectionProfile | null | undefined, userId: string): string {
	const name = resolveDisplayName(profile);
	if (name) return name;
	const legacy = profile?.userName?.trim();
	if (legacy) return `@${legacy.replace(/^@/, '')}`;
	return `User ${userId}`;
}

/**
 * The owner's own collection in `libraryId` (user-level uploads, and videos
 * of a channel that no longer exists). Stored on the profile like a channel's;
 * undefined when the user has no profile.
 */
export async function ensureUserCollection(
	profiles: R2Bucket,
	bunny: CollectionClient,
	libraryId: number,
	userId: string,
): Promise<string | undefined> {
	const repo = new R2Repository<CollectionProfile>(profiles);
	const profile = await repo.getObject(userId);
	if (!profile) return undefined;
	const existing = storedCollectionId(profile, libraryId);
	if (existing) return existing;
	return ensureChannelCollection(repo, bunny, libraryId, userId, userCollectionName(profile, userId));
}

/**
 * The collection a new upload goes into, in `libraryId`:
 * - a real channel (not deleted): the channel's collection;
 * - a user-level upload (channelId is the owner) or a channel that is gone:
 *   the owner's user collection.
 * undefined on failure (the video is then created outside any collection; the
 * backfill places it later).
 */
export async function uploadCollection(
	env: { channels: R2Bucket; profiles?: R2Bucket },
	bunny: CollectionClient,
	libraryId: number,
	channelId: string,
	ownerId: string,
): Promise<string | undefined> {
	let lastError: unknown;
	// One retry for a transient Bunny/R2 failure; after that the processing
	// check files the video (placeVideoInCollection), so it never stays at the root
	for (let attempt = 1; attempt <= 2; attempt++) {
		try {
			return await resolveUploadCollection(env, bunny, libraryId, channelId, ownerId);
		} catch (error) {
			lastError = error;
		}
	}
	logger.warn('[ChannelCollection] Collection step failed; the processing check will file the video', {
		channelId,
		ownerId,
		libraryId,
		error: lastError instanceof Error ? lastError.message : String(lastError),
	});
	return undefined;
}

async function resolveUploadCollection(
	env: { channels: R2Bucket; profiles?: R2Bucket },
	bunny: CollectionClient,
	libraryId: number,
	channelId: string,
	ownerId: string,
): Promise<string | undefined> {
	if (channelId && channelId !== ownerId) {
		const channels = new R2Repository<CollectionChannel & { isDeleted?: boolean }>(env.channels);
		const channel = await channels.getObject(channelId);
		if (channel && !channel.isDeleted) {
			const existing = storedCollectionId(channel, libraryId);
			if (existing) return existing;
			const collectionId = await ensureChannelCollection(channels, bunny, libraryId, channelId, channel.name || `Channel ${channelId}`);
			logger.debug('[ChannelCollection] Channel collection ready for upload', { channelId, libraryId, collectionId });
			return collectionId;
		}
		logger.debug('[ChannelCollection] Channel not found; using the owner collection', { channelId, ownerId });
	}
	if (!env.profiles) return undefined;
	const collectionId = await ensureUserCollection(env.profiles, bunny, libraryId, ownerId);
	logger.debug('[ChannelCollection] User collection ready for upload', { ownerId, libraryId, collectionId });
	return collectionId;
}

/**
 * A reused upload (same file initiated again, lib/uploads/initiateOnce.ts)
 * keeps the Bunny video an earlier initiate made, possibly before collections
 * were set on that path: file it into its collection now. Never throws.
 */
export async function fileReusedVideo(
	env: { channels: R2Bucket; profiles?: R2Bucket },
	bunny: CollectionClient & { updateVideo(libraryId: number, videoId: string, data: { collectionId?: string }): Promise<unknown> },
	libraryId: number,
	videoId: string,
	channelId: string,
	ownerId: string,
	target?: Promise<string | undefined>,
): Promise<void> {
	const collectionId = await (target ?? uploadCollection(env, bunny, libraryId, channelId, ownerId));
	if (!collectionId) return;
	try {
		await bunny.updateVideo(libraryId, videoId, { collectionId });
	} catch (error) {
		logger.warn('[ChannelCollection] Could not file the reused video; the processing check will', {
			videoId,
			libraryId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export type PlacementOutcome = 'placed' | 'already' | 'no_collection' | 'failed';

/**
 * Safety net for uploads whose collection step failed or was skipped
 * (2026-11-12: bulk uploads landed at the library root): the processing
 * check calls this with Bunny's view of the video, and a video still at the
 * root is moved into its channel's (or owner's) collection in its own
 * library. Never throws; a failure is logged at warn and retried on the next
 * check (and the backfill catches anything left).
 */
export async function placeVideoInCollection(
	env: BunnyLibrariesEnv & { channels: R2Bucket; profiles?: R2Bucket },
	video: LibraryHints & { id: string; channelId?: string; userId?: string },
	currentCollectionId: string | null | undefined,
): Promise<PlacementOutcome> {
	if (currentCollectionId) return 'already';
	if (!video.userId) return 'no_collection';
	// Bunny's id of the video (new videos: the stored ref); none: nothing to file at Bunny
	const bunnyId = bunnyRef(video as never);
	if (!bunnyId) return 'no_collection';
	try {
		const { client, libraryId } = bunnyClient(env, await bunnyLibraryForVideo(env, video));
		const target = await resolveUploadCollection(env, client, libraryId, video.channelId || video.userId, video.userId);
		if (!target) return 'no_collection';
		await client.updateVideo(libraryId, bunnyId, { collectionId: target });
		logger.info('[ChannelCollection] Video filed into its collection', { videoId: video.id, libraryId, collectionId: target });
		return 'placed';
	} catch (error) {
		logger.warn('[ChannelCollection] Could not file the video into its collection; retried on the next check', {
			videoId: video.id,
			channelId: video.channelId,
			error: error instanceof Error ? error.message : String(error),
		});
		return 'failed';
	}
}

/** Client per configured library (each with its own API key) */
async function clientsFor(env: BunnyLibrariesEnv): Promise<{ clientFor: ClientFor; libraryIds: number[] }> {
	const libraries = await bunnyLibraries(env);
	return {
		libraryIds: libraries.map((l) => l.libraryId),
		clientFor: async (libraryId) => {
			const library = libraries.find((l) => l.libraryId === libraryId);
			return library?.apiKey ? bunnyClient(env, library).client : undefined;
		},
	};
}

/**
 * After a rename of a channel or a user: rename their collection in every
 * library this env knows. Best effort, never throws.
 */
export async function renameCollectionsFor(env: BunnyLibrariesEnv, ownerId: string, record: CollectionChannel | null | undefined, name: string | undefined): Promise<number> {
	if (!name || channelCollections(record).length === 0) return 0;
	try {
		const { clientFor } = await clientsFor(env);
		return await renameChannelCollections(clientFor, ownerId, record!, name);
	} catch (error) {
		logger.warn('[ChannelCollection] Rename skipped', { ownerId, error: error instanceof Error ? error.message : String(error) });
		return 0;
	}
}

/** After a channel rename */
export function renameCollectionsForChannel(env: BunnyLibrariesEnv, channelId: string, channel: CollectionChannel | null | undefined): Promise<number> {
	return renameCollectionsFor(env, channelId, channel, channel?.name);
}

/** After a profile's display name or handle changed */
export function renameCollectionsForUser(env: BunnyLibrariesEnv, userId: string, profile: CollectionProfile | null | undefined): Promise<number> {
	return renameCollectionsFor(env, userId, profile, userCollectionName(profile, userId));
}

/**
 * Purge of a channel or a user: remove their collections in every library
 * (soft delete keeps them). Best effort, never throws.
 */
export async function removeCollectionsFor(env: BunnyLibrariesEnv, ownerId: string, record: CollectionChannel | null | undefined): Promise<number> {
	if (channelCollections(record).length === 0) return 0;
	try {
		const { clientFor, libraryIds } = await clientsFor(env);
		const deleted = await deleteChannelCollections(clientFor, libraryIds, ownerId, record!);
		if (deleted > 0) logger.debug('[ChannelCollection] Collections removed', { ownerId, deleted });
		return deleted;
	} catch (error) {
		logger.warn('[ChannelCollection] Collection cleanup failed', { ownerId, error: error instanceof Error ? error.message : String(error) });
		return 0;
	}
}
