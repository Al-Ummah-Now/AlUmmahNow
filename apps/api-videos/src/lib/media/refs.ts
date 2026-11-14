/**
 * Our video ids and provider-side ids (docs/media-delivery/PROVIDERS.md §IDs).
 *
 * Every new video gets our own id (a UUID, the same shape as the Bunny GUIDs older videos use as
 * their id, so every route and id check keeps working). A provider's id for its copy is stored on
 * the record (media.providers.<p>.ref) and, for lookups from the provider's side (Bunny listings:
 * the reaper's orphan sweep, collection repair), in D1 media_provider_refs. Videos uploaded before
 * providers existed have no row: their id is their Bunny GUID.
 */
import type { MediaProviderId, StoredProviderRef, VideoMediaProviders } from '@al-ummah/shared-types';
import { logger } from '../logger';

type RefsEnv = { SEARCH_DB?: D1Database };
type VideosEnv = RefsEnv & { videos: R2Bucket };

export function newVideoId(): string {
	return crypto.randomUUID();
}

/** The `media` field of a new video: one pending entry per provider that takes the upload. */
export function initialMedia(
	targets: readonly MediaProviderId[],
	p: { videoId: string; bunnyGuid?: string | null; bunnyLibraryId?: number; now?: Date },
): VideoMediaProviders {
	const addedAt = (p.now ?? new Date()).toISOString();
	const providers: VideoMediaProviders['providers'] = {};
	for (const target of targets) {
		if (target === 'bunny') {
			if (!p.bunnyGuid) continue;
			providers.bunny = { ref: p.bunnyGuid, status: 'pending', addedAt, ...(p.bunnyLibraryId ? { libraryId: p.bunnyLibraryId } : {}) } satisfies StoredProviderRef;
		} else {
			providers[target] = { ref: p.videoId, status: 'pending', addedAt } satisfies StoredProviderRef;
		}
	}
	return { providers };
}

/** Remember a provider-side id of a video (best effort: the record holds it too). */
export async function recordProviderRef(env: RefsEnv, provider: MediaProviderId, ref: string, videoId: string): Promise<void> {
	if (!env.SEARCH_DB || ref === videoId) return;
	try {
		await env.SEARCH_DB.prepare('INSERT OR IGNORE INTO media_provider_refs (provider, ref, video_id, created_at) VALUES (?1, ?2, ?3, ?4)')
			.bind(provider, ref, videoId, new Date().toISOString())
			.run();
	} catch (error) {
		logger.warn('[Media] Could not record a provider id', { provider, videoId, error: error instanceof Error ? error.message : String(error) });
	}
}

/**
 * Our video id for a provider-side id; the id itself when no row maps it (legacy videos, whose id
 * is their Bunny GUID). Throws when D1 fails: a caller deciding "no record" must not guess.
 */
export async function videoIdForRef(env: RefsEnv, provider: MediaProviderId, ref: string): Promise<string> {
	if (!env.SEARCH_DB) return ref;
	const row = await env.SEARCH_DB.prepare('SELECT video_id FROM media_provider_refs WHERE provider = ?1 AND ref = ?2').bind(provider, ref).first<{ video_id: string }>();
	return row?.video_id ?? ref;
}

/**
 * The record a Bunny GUID belongs to: by id (legacy), else through media_provider_refs. Reads the
 * bucket directly so an R2 error throws instead of reading as "missing".
 */
export async function readRecordByBunnyGuid<T = Record<string, unknown>>(env: VideosEnv, guid: string): Promise<{ id: string; record: T } | null> {
	const direct = await env.videos.get(guid);
	if (direct) return { id: guid, record: (await direct.json()) as T };
	const id = await videoIdForRef(env, 'bunny', guid);
	if (id === guid) return null;
	const mapped = await env.videos.get(id);
	return mapped ? { id, record: (await mapped.json()) as T } : null;
}
