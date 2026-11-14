/**
 * Bunny Stream adapter. Bunny keeps its own video id (the GUID); legacy rows (no `media` field) use
 * the video id itself as that GUID, which is what every video uploaded before providers existed is.
 * Bunny's state on those rows is the record's own uploadStatus / playUrl / availableResolutions.
 */
import type { VideoProviderRecord } from '@al-ummah/shared-types';
import { bunnyDirectoryToken, bunnyFileToken, signedBunnyUrl, tokenExpiry, unsignedBunnyUrl } from '../../bunny-signing';
import { bunnyLibraries, bunnyLibraryForVideo, type BunnyLibrariesEnv } from '../../bunny/libraries';
import { isLegacyRow, storedRef, type MediaProvider, type ProbeResult, type ProviderPlayback, type ProviderVideo, type ProvidersEnv } from './types';

const BUNNY_STREAM_HOST = /^https:\/\/(vz-[a-z0-9-]+\.b-cdn\.net)\/([0-9a-fA-F-]{36})\/([A-Za-z0-9_.-]+)$/;
const PROBE_TIMEOUT_MS = 5_000;

/** The Bunny GUID of a video, or null when Bunny holds no copy. */
export function bunnyRef(video: ProviderVideo): string | null {
	const stored = storedRef(video, 'bunny');
	if (stored) return stored.ref;
	return isLegacyRow(video) ? video.id : null;
}

function legacyStatus(video: ProviderVideo): VideoProviderRecord['status'] {
	const s = video.uploadStatus;
	if (!s || s === 'ready') return 'ready';
	if (s === 'failed') return 'failed';
	if (s === 'processing') return 'processing';
	return 'pending';
}

export const bunnyProvider: MediaProvider = {
	id: 'bunny',
	ingest: 'upload-proxy',

	record(video) {
		const ref = bunnyRef(video);
		if (!ref) return null;
		const stored = storedRef(video, 'bunny');
		if (stored) {
			return {
				provider: 'bunny',
				ref,
				status: stored.status ?? 'pending',
				renditions: video.availableResolutions ?? [],
				...(stored.readyAt ? { readyAt: stored.readyAt } : {}),
				...(stored.error ? { error: stored.error } : {}),
			};
		}
		return {
			provider: 'bunny',
			ref,
			status: legacyStatus(video),
			renditions: video.availableResolutions ?? [],
			...(video.playableAt ? { readyAt: video.playableAt } : {}),
			legacy: true,
		};
	},

	async playback(env, video, record, opts): Promise<ProviderPlayback | null> {
		const library = await bunnyLibraryForVideo(env as BunnyLibrariesEnv, { bunnyLibraryId: storedRef(video, 'bunny')?.libraryId ?? video.bunnyLibraryId, playUrl: video.playUrl, thumbnailUrl: video.thumbnailUrl });
		const host = library.host;
		if (!host) return null;
		const ref = record.ref;
		const sign = env.BUNNY_SIGN_URLS === 'true' && !!library.tokenKey;
		const expires = tokenExpiry(opts?.nowSeconds);
		const playUrl = sign
			? signedBunnyUrl(host, ref, 'playlist.m3u8', await bunnyDirectoryToken(library.tokenKey, ref, expires), expires)
			: `https://${host}/${ref}/playlist.m3u8`;
		// Bunny's frame: the stored one when it is this video's Bunny frame (its file name may differ), else the default
		const stored = video.thumbnailUrl ? BUNNY_STREAM_HOST.exec(unsignedBunnyUrl(video.thumbnailUrl)) : null;
		const file = stored && stored[2] === ref ? stored[3]! : 'thumbnail.jpg';
		const path = `/${ref}/${file}`;
		const thumbnailUrl = sign ? `https://${host}${path}?token=${await bunnyFileToken(library.tokenKey, path, expires)}&expires=${expires}` : `https://${host}${path}`;
		return { playUrl, thumbnailUrl };
	},

	isOwnAutoThumbnail(video, url) {
		if (!url || video.thumbnailType === 'custom') return false;
		const m = BUNNY_STREAM_HOST.exec(unsignedBunnyUrl(url));
		return !!m && m[2] === bunnyRef(video);
	},

	async probe(env: ProvidersEnv): Promise<ProbeResult> {
		const started = Date.now();
		try {
			const libraries = await bunnyLibraries(env as BunnyLibrariesEnv);
			const host = libraries.find((l) => l.primary)?.host ?? libraries.find((l) => l.host)?.host;
			if (!host) return { ok: false, ms: 0, error: 'no Bunny CDN host configured' };
			// The CDN edge answers the bare host with 403/404 when it is up; 5xx or no answer means down
			const res = await fetch(`https://${host}/`, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
			return { ok: res.status < 500, ms: Date.now() - started, status: res.status };
		} catch (error) {
			return { ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
		}
	},
};
