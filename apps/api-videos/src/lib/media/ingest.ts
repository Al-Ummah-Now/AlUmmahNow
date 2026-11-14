/**
 * Where a new upload goes (docs/media-delivery/PROVIDERS.md §Ingest). Every upload path (single,
 * bulk, multipart, API create) asks here, so the Delivery settings decide:
 *
 *   planIngest ─► ingestTargets(settings, channel override)
 *              ─► our own video id (newVideoId)
 *              ─► Bunny targeted: create the Bunny video (its GUID becomes the stored ref)
 *              ─► media.providers: one pending entry per target
 *
 * Bunny takes the bytes through our TUS proxy as they arrive; R2 builds its copy from our kept
 * original (lib/media/originals.ts) once the upload completes (lib/uploads/lifecycle.ts).
 */
import { ingestTargets, type MediaProviderId, type VideoMediaProviders } from '@al-ummah/shared-types';
import { logger } from '../logger';
import { initialMedia, newVideoId, recordProviderRef } from './refs';
import { readMediaSettings } from './settings';

export interface IngestPlan {
	/** Our id of the new video */
	videoId: string;
	targets: MediaProviderId[];
	/** The Bunny video, when Bunny takes the upload */
	bunny: { guid: string; libraryId: number } | null;
	media: VideoMediaProviders;
}

type IngestEnv = { global_settings?: R2Bucket; SEARCH_DB?: D1Database };

/**
 * Decide the targets and create the provider-side videos that need creating up front (Bunny).
 * `createAtBunny` is called only when Bunny is a target.
 */
export async function planIngest(
	env: IngestEnv,
	channelId: string | null | undefined,
	createAtBunny: () => Promise<{ guid: string; libraryId: number }>,
): Promise<IngestPlan> {
	const settings = await readMediaSettings(env);
	const targets = ingestTargets(settings, channelId ?? undefined);
	const videoId = newVideoId();
	let bunny: IngestPlan['bunny'] = null;
	if (targets.includes('bunny')) {
		bunny = await createAtBunny();
		await recordProviderRef(env, 'bunny', bunny.guid, videoId);
	}
	logger.debug('[Media] Ingest planned', { videoId, channelId, targets, bunnyGuid: bunny?.guid });
	return { videoId, targets, bunny, media: initialMedia(targets, { videoId, bunnyGuid: bunny?.guid, bunnyLibraryId: bunny?.libraryId }) };
}

/** Does this record take its bytes through Bunny's TUS upload? */
export function uploadsToBunny(video: { media?: VideoMediaProviders } | null | undefined): boolean {
	return !video?.media || !!video.media.providers.bunny;
}
