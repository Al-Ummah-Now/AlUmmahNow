/**
 * Bunny CDN token authentication for Stream video URLs.
 *
 * With "CDN token authentication" enabled on the Stream library, Bunny only
 * serves files whose URL carries a valid token. We use a directory token in
 * the path form:
 *
 *   https://<host>/bcdn_token=<token>&expires=<ts>&token_path=%2F<video>%2F/<video>/playlist.m3u8
 *
 * Bunny resolves relative URLs inside the HLS playlists against that path, so
 * every rendition playlist and segment carries the same token. Still images
 * (thumbnails, previews) get a single-file token instead; see bunnyFileToken. (A query-string token would be dropped by the player
 * when it loads segments.)
 *
 * token = base64url(sha256(securityKey + signedPath + expires + "token_path=" + signedPath))
 */

const TOKEN_TTL_SECONDS = 6 * 60 * 60;
/** Expiry is rounded up to the hour so URLs stay identical (and cacheable) for an hour */
const EXPIRY_GRANULARITY_SECONDS = 60 * 60;

const VIDEO_ID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

function base64Url(bytes: ArrayBuffer): string {
	let binary = '';
	for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function tokenExpiry(nowSeconds: number = Math.floor(Date.now() / 1000)): number {
	const target = nowSeconds + TOKEN_TTL_SECONDS;
	return Math.ceil(target / EXPIRY_GRANULARITY_SECONDS) * EXPIRY_GRANULARITY_SECONDS;
}

/** Directory token for everything under /<videoId>/ */
export async function bunnyDirectoryToken(securityKey: string, videoId: string, expires: number): Promise<string> {
	const tokenPath = `/${videoId}/`;
	const data = new TextEncoder().encode(`${securityKey}${tokenPath}${expires}token_path=${tokenPath}`);
	return base64Url(await crypto.subtle.digest('SHA-256', data));
}

/** Signed form of https://<host>/<videoId>/<rest> */
export function signedBunnyUrl(host: string, videoId: string, rest: string, token: string, expires: number): string {
	const tokenPath = encodeURIComponent(`/${videoId}/`);
	return `https://${host}/bcdn_token=${token}&expires=${expires}&token_path=${tokenPath}/${videoId}/${rest}`;
}

/** Still images only ever need themselves; they never load relative URLs */
const IMAGE_FILE = /^[^?#]+\.(?:jpe?g|png|webp|gif|avif)$/i;

/**
 * File token for one exact path, query form:
 * https://<host>/<videoId>/<file>?token=<token>&expires=<ts>
 * token = base64url(sha256(securityKey + path + expires))
 *
 * Used for thumbnails and previews so a stored image URL (cards, watch
 * history, playlists) can never be reused to fetch the video's playlist.
 */
export async function bunnyFileToken(securityKey: string, path: string, expires: number): Promise<string> {
	const data = new TextEncoder().encode(`${securityKey}${path}${expires}`);
	return base64Url(await crypto.subtle.digest('SHA-256', data));
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite every unsigned https://<host>/<videoId>/<file> URL in a text body
 * (JSON) to its signed form. Already-signed URLs are left alone (their path
 * starts with bcdn_token=, not a video id). Tokens are computed once per video.
 */
export async function signBunnyUrlsInText(
	text: string,
	host: string,
	securityKey: string,
	nowSeconds?: number,
): Promise<string> {
	if (!host || !securityKey || !text.includes(host)) return text;

	const pattern = new RegExp(`https://${escapeRegExp(host)}/(${VIDEO_ID})/([^"'\\s\\\\<>]*)`, 'g');
	const matches = [...text.matchAll(pattern)];
	if (matches.length === 0) return text;

	const expires = tokenExpiry(nowSeconds);
	const directoryTokens = new Map<string, string>();
	const fileTokens = new Map<string, string>();
	for (const [, videoId, rest] of matches) {
		if (IMAGE_FILE.test(rest)) {
			const path = `/${videoId}/${rest}`;
			if (!fileTokens.has(path)) fileTokens.set(path, await bunnyFileToken(securityKey, path, expires));
		} else if (!rest.includes('token=') && !directoryTokens.has(videoId)) {
			directoryTokens.set(videoId, await bunnyDirectoryToken(securityKey, videoId, expires));
		}
	}

	return text.replace(pattern, (match, videoId: string, rest: string) => {
		const fileToken = fileTokens.get(`/${videoId}/${rest}`);
		if (fileToken) return `https://${host}/${videoId}/${rest}?token=${fileToken}&expires=${expires}`;
		const directoryToken = directoryTokens.get(videoId);
		// Already file-signed (query token) or nothing to sign: leave as is
		if (!directoryToken || rest.includes('token=')) return match;
		return signedBunnyUrl(host, videoId, rest, directoryToken, expires);
	});
}
