/**
 * Bunny Stream libraries this environment talks to.
 *
 * - The primary library (`bunny-stream-key`, `bunny_stream_library_id`,
 *   `bunny_hostname`, `BUNNY_TOKEN_KEY`) receives every new upload and live
 *   stream.
 * - An optional legacy library (`BUNNY_LEGACY_*`) only serves the videos that
 *   already live there: playback signing, thumbnails, the processing loop,
 *   deletes, title/collection updates and R2 transcode sources all use it for
 *   those videos. Production: 400189 (vz-215a1ffd) is legacy, 498994 primary.
 *
 * A video belongs to the library named by its record (`bunnyLibraryId`, set
 * on new uploads), else to the library whose CDN host serves its playUrl (or
 * thumbnail), else to the primary library.
 */

import { getSecret } from '../env-helpers';
import { BunnyStreamClient } from './stream';

export interface BunnyLibrariesEnv {
	'bunny-stream-key'?: unknown;
	bunny_stream_library_id?: unknown;
	bunny_hostname?: string;
	/** "true" once CDN token authentication is on: URLs of every library with a token key are signed */
	BUNNY_SIGN_URLS?: string;
	BUNNY_TOKEN_KEY?: unknown;
	/** Legacy library (old videos only): id, CDN host, API key, CDN token key */
	BUNNY_LEGACY_LIBRARY_ID?: string;
	BUNNY_LEGACY_HOSTNAME?: string;
	BUNNY_LEGACY_STREAM_KEY?: unknown;
	BUNNY_LEGACY_TOKEN_KEY?: unknown;
}

export interface BunnyLibrary {
	libraryId: number;
	/** CDN host, e.g. vz-25839d05-80d.b-cdn.net (undefined when not configured) */
	host?: string;
	apiKey: string;
	/** CDN token authentication key; empty when this library's URLs are not signed */
	tokenKey: string;
	primary: boolean;
}

/** Fields of a video record that tell its library */
export interface LibraryHints {
	bunnyLibraryId?: number | string | null;
	playUrl?: string | null;
	thumbnailUrl?: string | null;
}

const cache = new WeakMap<object, Promise<BunnyLibrary[]>>();

async function load(env: BunnyLibrariesEnv): Promise<BunnyLibrary[]> {
	const sign = env.BUNNY_SIGN_URLS === 'true';
	const libraries: BunnyLibrary[] = [];
	// Missing secrets do not throw here (signing only needs hosts and token
	// keys); Bunny API callers go through bunnyApi(), which does.
	const primaryId = parseInt(await getSecret(env.bunny_stream_library_id, 'bunny_stream_library_id'), 10);
	libraries.push({
		libraryId: primaryId,
		host: env.bunny_hostname || undefined,
		apiKey: await getSecret(env['bunny-stream-key'], 'bunny-stream-key'),
		tokenKey: sign ? await getSecret(env.BUNNY_TOKEN_KEY, 'BUNNY_TOKEN_KEY') : '',
		primary: true,
	});
	const legacyId = parseInt(env.BUNNY_LEGACY_LIBRARY_ID || '', 10);
	if (Number.isFinite(legacyId) && legacyId !== primaryId) {
		const apiKey = await getSecret(env.BUNNY_LEGACY_STREAM_KEY, 'BUNNY_LEGACY_STREAM_KEY');
		libraries.push({
			libraryId: legacyId,
			host: env.BUNNY_LEGACY_HOSTNAME || undefined,
			apiKey,
			tokenKey: sign ? await getSecret(env.BUNNY_LEGACY_TOKEN_KEY, 'BUNNY_LEGACY_TOKEN_KEY') : '',
			primary: false,
		});
	}
	return libraries;
}

/** Every configured library, primary first. Cached per env object. */
export function bunnyLibraries(env: BunnyLibrariesEnv): Promise<BunnyLibrary[]> {
	let entry = cache.get(env as object);
	if (!entry) {
		entry = load(env);
		cache.set(env as object, entry);
		entry.catch(() => cache.delete(env as object));
	}
	return entry;
}

/** The library new uploads and live streams go to */
export async function primaryBunnyLibrary(env: BunnyLibrariesEnv): Promise<BunnyLibrary> {
	return (await bunnyLibraries(env))[0];
}

/** Host of a Bunny Stream CDN URL (https://vz-….b-cdn.net/…), else undefined */
export function bunnyHostOf(url: string | null | undefined): string | undefined {
	if (!url) return undefined;
	const match = /^https:\/\/([a-z0-9-]+\.b-cdn\.net)\//i.exec(url);
	return match ? match[1].toLowerCase() : undefined;
}

/** Library of a video by its record alone; undefined when the record names an unknown library */
export function pickLibrary(libraries: BunnyLibrary[], video: LibraryHints | null | undefined): BunnyLibrary | undefined {
	const id = video?.bunnyLibraryId != null ? Number(video.bunnyLibraryId) : NaN;
	if (Number.isFinite(id)) return libraries.find((l) => l.libraryId === id);
	for (const url of [video?.playUrl, video?.thumbnailUrl]) {
		const host = bunnyHostOf(url);
		if (!host) continue;
		const byHost = libraries.find((l) => l.host?.toLowerCase() === host);
		if (byHost) return byHost;
	}
	return libraries[0];
}

/**
 * The library a video lives in. Falls back to the primary library when the
 * record names a library this environment does not know (logged by callers
 * that care), so a misconfiguration fails like before rather than throwing.
 */
export async function bunnyLibraryForVideo(env: BunnyLibrariesEnv, video: LibraryHints | null | undefined): Promise<BunnyLibrary> {
	const libraries = await bunnyLibraries(env);
	return pickLibrary(libraries, video) ?? libraries[0];
}

/** Library serving a CDN host, if any */
export async function bunnyLibraryForHost(env: BunnyLibrariesEnv, host: string | null | undefined): Promise<BunnyLibrary | undefined> {
	if (!host) return undefined;
	const lower = host.toLowerCase();
	return (await bunnyLibraries(env)).find((l) => l.host?.toLowerCase() === lower);
}

/** CDN hosts of every configured library (primary first) */
export async function bunnyHosts(env: BunnyLibrariesEnv): Promise<string[]> {
	return (await bunnyLibraries(env)).map((l) => l.host).filter((h): h is string => !!h);
}

/** Library id and API key for Bunny Stream API calls; throws when either is missing */
export function bunnyApi(library: BunnyLibrary): { libraryId: number; apiKey: string } {
	if (!Number.isFinite(library.libraryId)) throw new Error('Missing required secret: bunny_stream_library_id');
	if (!library.apiKey) throw new Error(library.primary ? 'Missing required secret: bunny-stream-key' : `Missing API key of Bunny library ${library.libraryId}`);
	return { libraryId: library.libraryId, apiKey: library.apiKey };
}

/** A Stream API client (with the env's name prefix) for one library */
export function bunnyClient(env: unknown, library: BunnyLibrary): { client: BunnyStreamClient; libraryId: number; library: BunnyLibrary } {
	const { libraryId, apiKey } = bunnyApi(library);
	return { client: new BunnyStreamClient(apiKey).forEnv(env), libraryId, library };
}

/** A Stream API client for the library `video` lives in */
export async function bunnyClientForVideo(env: BunnyLibrariesEnv, video: LibraryHints | null | undefined) {
	return bunnyClient(env, await bunnyLibraryForVideo(env, video));
}

/** A Stream API client for the primary library (new uploads, live streams) */
export async function primaryBunnyClient(env: BunnyLibrariesEnv) {
	return bunnyClient(env, await primaryBunnyLibrary(env));
}
