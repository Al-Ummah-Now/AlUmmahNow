/**
 * Bunny recordings on a token-auth library need a signed playlist URL (watch page, Studio and the
 * media worker that extracts review frames from it). Other URLs are returned unchanged.
 */
import { bunnyDirectoryToken, signedBunnyUrl, tokenExpiry } from '../bunny-signing';
import { getSecret } from '../env-helpers';

export interface VodSignEnv {
	BUNNY_SIGN_HOSTNAME?: string;
	bunny_hostname?: string;
	BUNNY_SIGN_URLS?: string;
	BUNNY_TOKEN_KEY?: unknown;
}

export async function signLiveVodUrl(env: VodSignEnv, url: string | null): Promise<string | null> {
	const host = env.BUNNY_SIGN_HOSTNAME || env.bunny_hostname;
	if (!url || !host || env.BUNNY_SIGN_URLS !== 'true') return url;
	// Parsed, not a regex built from the host (CodeQL): exactly https://<host>/<video id>/playlist.m3u8
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return url;
	}
	const m = /^\/([0-9a-f-]{36})\/playlist\.m3u8$/.exec(parsed.pathname);
	if (parsed.protocol !== 'https:' || parsed.host !== host || parsed.search || parsed.hash || !m || url !== `https://${host}${parsed.pathname}`) return url;
	const key = await getSecret(env.BUNNY_TOKEN_KEY as never, 'BUNNY_TOKEN_KEY');
	if (!key) return url;
	const expires = tokenExpiry();
	return signedBunnyUrl(host, m[1], 'playlist.m3u8', await bunnyDirectoryToken(key, m[1], expires), expires);
}
