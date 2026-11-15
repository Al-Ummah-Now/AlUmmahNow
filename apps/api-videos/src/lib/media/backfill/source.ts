/**
 * The Bunny file a backfill copies as our original: Bunny's `original` when its CDN serves it, else
 * its highest MP4 (the same ranking as the transcode's own source, r2-delivery.ts sourceFiles).
 * Probed with a one-byte range request, so the real size comes from Bunny's Content-Range.
 */
import { bunnyDirectoryToken, signedBunnyUrl, tokenExpiry } from '../../bunny-signing';
import { bunnyLibraryForVideo, type BunnyLibrariesEnv, type BunnyLibrary, type LibraryHints } from '../../bunny/libraries';
import { getBunnyVideo } from '../../processing/loop';
import { sourceFiles } from '../r2-delivery';

export interface BunnyFacts {
	library: BunnyLibrary;
	lengthSeconds: number | null;
	height: number | null;
	files: string[];
}

export interface ProbedSource {
	file: string;
	bytes: number;
}

/** Bunny's view of a video in its own library (null when Bunny no longer has it). */
export async function bunnyFacts(env: BunnyLibrariesEnv, guid: string, hints: LibraryHints): Promise<BunnyFacts | null> {
	const library = await bunnyLibraryForVideo(env, hints);
	const state = await getBunnyVideo(library, guid);
	if (!state) return null;
	return {
		library,
		lengthSeconds: typeof state.length === 'number' && state.length > 0 ? state.length : null,
		height: typeof state.height === 'number' && state.height > 0 ? state.height : null,
		files: sourceFiles(state as never),
	};
}

/** A signed CDN URL of one of the video's files (fresh token on every call). */
export async function bunnyFileUrl(library: BunnyLibrary, guid: string, file: string): Promise<string | null> {
	if (!library.host) return null;
	if (!library.tokenKey) return `https://${library.host}/${guid}/${file}`;
	const expires = tokenExpiry();
	return signedBunnyUrl(library.host, guid, file, await bunnyDirectoryToken(library.tokenKey, guid, expires), expires);
}

/** Total size from a Content-Range header ("bytes 0-0/12345"). */
export function totalFromContentRange(header: string | null): number | null {
	const m = header ? /\/(\d+)\s*$/.exec(header) : null;
	const n = m ? Number(m[1]) : NaN;
	return Number.isFinite(n) && n > 0 ? n : null;
}

/** The first file Bunny serves, and its size. Null when none answers. */
export async function probeSource(library: BunnyLibrary, guid: string, files: string[], fetchImpl: typeof fetch = fetch): Promise<ProbedSource | null> {
	for (const file of files) {
		const url = await bunnyFileUrl(library, guid, file);
		if (!url) return null;
		try {
			const res = await fetchImpl(url, { headers: { Range: 'bytes=0-0' } });
			const total = res.status === 206 ? totalFromContentRange(res.headers.get('content-range')) : res.status === 200 ? Number(res.headers.get('content-length')) || null : null;
			await res.body?.cancel().catch(() => undefined);
			if (total) return { file, bytes: total };
		} catch {
			// next candidate
		}
	}
	return null;
}
