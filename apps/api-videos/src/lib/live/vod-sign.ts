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
	const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const m = new RegExp(`^https://${escaped}/([0-9a-f-]{36})/playlist\\.m3u8$`).exec(url);
	if (!m) return url;
	const key = await getSecret(env.BUNNY_TOKEN_KEY as never, 'BUNNY_TOKEN_KEY');
	if (!key) return url;
	const expires = tokenExpiry();
	return signedBunnyUrl(host, m[1], 'playlist.m3u8', await bunnyDirectoryToken(key, m[1], expires), expires);
}
