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

/** Path-form token segment: /bcdn_token=<t>&expires=<ts>&token_path=<encoded path>/ */
const PATH_TOKEN = /^(https:\/\/[^/?#]+)\/bcdn_token=[^/?#]*\/(.*)$/;
/** Token query parameters a Bunny URL may carry */
const TOKEN_PARAMS = new Set(['token', 'expires', 'token_path', 'token_countries', 'token_countries_blocked']);

/**
 * The unsigned form of a Bunny URL: drops a path-form directory token and the
 * query-form token parameters. Tokens expire, so a signed URL must never be
 * stored; responses sign it again (signBunnyUrlsInText). Any other URL is
 * returned unchanged.
 */
export function unsignedBunnyUrl(url: string): string {
	if (typeof url !== 'string' || !url.includes('token')) return url;
	let out = url;
	const path = PATH_TOKEN.exec(out);
	if (path) out = `${path[1]}/${path[2]}`;
	const q = out.indexOf('?');
	if (q >= 0) {
		const hash = out.indexOf('#', q);
		const query = out.slice(q + 1, hash >= 0 ? hash : undefined);
		const kept = query.split('&').filter((pair) => pair && !TOKEN_PARAMS.has(decodeURIComponent(pair.split('=')[0]).toLowerCase()));
		if (kept.length !== query.split('&').filter(Boolean).length) {
			out = out.slice(0, q) + (kept.length ? `?${kept.join('&')}` : '') + (hash >= 0 ? out.slice(hash) : '');
		}
	}
	return out;
}

/** True when the URL carries a Bunny token (path or query form) */
export function isSignedBunnyUrl(url: string): boolean {
	return unsignedBunnyUrl(url) !== url;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fields that hold a still image of the record's video (file token) */
const IMAGE_FIELDS = new Set(['thumbnailUrl', 'thumbnail', 'previewUrl', 'poster', 'videoThumbnail']);
/** Field whose values are image URLs per size, e.g. { hd, sd } */
const IMAGE_MAP_FIELD = 'thumbnailSizes';
/** The only field that gets a directory token (it unlocks playback) */
const PLAYLIST_FIELD = 'playUrl';
const PLAYLIST_FILE = 'playlist.m3u8';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Sign Bunny Stream URLs in a JSON response body.
 *
 * Not a signing oracle: only known URL fields are considered (never free text
 * such as descriptions or comments), and a URL is signed only when its video
 * id is the id (or videoId) of the object that holds it, so a record cannot
 * obtain tokens for another video. A new video's Bunny copy lives under its own GUID
 * (docs/media-delivery/PROVIDERS.md §IDs): `resolveOwner` maps such a GUID to our id, and the
 * URL is signed only when that id owns the object. Only the canonical playUrl
 * (<id>/playlist.m3u8) gets a directory token; images get single-file tokens;
 * anything else stays unsigned. Non-JSON bodies are returned unchanged.
 */
export async function signBunnyUrlsInText(
	text: string,
	host: string,
	securityKey: string,
	nowSeconds?: number,
	resolveOwner?: (guid: string) => Promise<string | null>,
): Promise<string> {
	if (!host || !securityKey || !text.includes(host)) return text;

	let body: Json;
	try {
		body = JSON.parse(text) as Json;
	} catch {
		return text;
	}

	// One plain file name only: no '/', '%' or dot segments, so the signed path
	// is exactly the path the CDN serves (no traversal into another video)
	const urlPattern = new RegExp(`^https://${escapeRegExp(host)}/(${VIDEO_ID})/([A-Za-z0-9_-][A-Za-z0-9_.-]*)$`);
	const expires = tokenExpiry(nowSeconds);
	const directoryTokens = new Map<string, string>();
	const resolved = new Map<string, Promise<string | null>>();
	let changed = false;

	const owns = async (owners: Set<string>, guid: string): Promise<boolean> => {
		if (owners.has(guid)) return true;
		if (!resolveOwner) return false;
		if (!resolved.has(guid)) resolved.set(guid, resolveOwner(guid).catch(() => null));
		const id = await resolved.get(guid)!;
		return !!id && owners.has(id);
	};

	// A stored URL may already carry a token (Studio once saved signed frame
	// URLs): sign its unsigned form again, so an old token never reaches a client
	const signImage = async (stored: string, owners: Set<string>): Promise<string> => {
		const url = unsignedBunnyUrl(stored);
		const match = urlPattern.exec(url);
		if (!match || !IMAGE_FILE.test(match[2]) || match[2].includes('..') || !(await owns(owners, match[1]))) return stored;
		const path = `/${match[1]}/${match[2]}`;
		changed = true;
		return `https://${host}${path}?token=${await bunnyFileToken(securityKey, path, expires)}&expires=${expires}`;
	};

	const signPlaylist = async (stored: string, owners: Set<string>): Promise<string> => {
		const url = unsignedBunnyUrl(stored);
		const match = urlPattern.exec(url);
		if (!match || match[2] !== PLAYLIST_FILE || !(await owns(owners, match[1]))) return stored;
		const videoId = match[1];
		if (!directoryTokens.has(videoId)) {
			directoryTokens.set(videoId, await bunnyDirectoryToken(securityKey, videoId, expires));
		}
		changed = true;
		return signedBunnyUrl(host, videoId, PLAYLIST_FILE, directoryTokens.get(videoId)!, expires);
	};

	const walk = async (node: Json): Promise<void> => {
		if (Array.isArray(node)) {
			for (const item of node) await walk(item);
			return;
		}
		if (!node || typeof node !== 'object') return;

		const owners = new Set<string>();
		if (typeof node.id === 'string') owners.add(node.id);
		if (typeof node.videoId === 'string') owners.add(node.videoId);

		for (const [key, value] of Object.entries(node)) {
			if (typeof value === 'string') {
				if (owners.size === 0) continue;
				if (key === PLAYLIST_FIELD) node[key] = await signPlaylist(value, owners);
				else if (IMAGE_FIELDS.has(key)) node[key] = await signImage(value, owners);
			} else if (key === IMAGE_MAP_FIELD && value && typeof value === 'object' && !Array.isArray(value)) {
				for (const [size, url] of Object.entries(value)) {
					if (typeof url === 'string' && owners.size > 0) value[size] = await signImage(url, owners);
				}
			} else {
				await walk(value);
			}
		}
	};

	await walk(body);
	return changed ? JSON.stringify(body) : text;
}
