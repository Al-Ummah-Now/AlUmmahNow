/**
 * Private R2 frames in JSON responses (docs/media-delivery/PROVIDERS.md §Thumbnails). A video
 * whose only copy is on R2 stores its automatic frame unsigned, `https://<media host>/priv/-/<id>/<rev>/thumb.jpg`
 * (lib/media/r2-delivery.ts storedR2Frame): tokens expire, so a stored URL never carries one.
 * Each response signs it again with MEDIA_SIGN_KEY, like Bunny URLs (lib/bunny-signing.ts).
 *
 * Same rules as the Bunny signer: only the known image fields, and only when the frame's video id
 * is the id (or videoId) of the object holding it. The token is a file token (mediaFileToken): the
 * media Worker serves that one frame with it and never the playlist or segments, so a card's image
 * cannot be turned into playback of a private video. Folder tokens come only from the playback
 * endpoint, after its visibility check.
 */
import { mediaFrameUrl, mediaTokenExpiry, MEDIA_THUMBNAIL } from '@al-ummah/shared-types';

const VIDEO_ID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const IMAGE_FIELDS = new Set(['thumbnailUrl', 'thumbnail', 'previewUrl', 'poster', 'videoThumbnail']);
const IMAGE_MAP_FIELD = 'thumbnailSizes';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sign stored private R2 frames in a JSON body; any other body or URL is returned unchanged. */
export async function signMediaFramesInText(text: string, host: string, key: string, nowSeconds?: number): Promise<string> {
	if (!host || !key || !text.includes(`${host}/priv/`)) return text;
	let body: Json;
	try {
		body = JSON.parse(text) as Json;
	} catch {
		return text;
	}
	// Any token segment (the stored "-" or an expired one), then exactly <id>/<rev>/thumb.jpg
	const framePattern = new RegExp(`^https://${escapeRegExp(host)}/priv/[^/?#]+/(${VIDEO_ID})/([A-Za-z0-9_-]{1,64})/${escapeRegExp(MEDIA_THUMBNAIL)}$`);
	const expires = mediaTokenExpiry(nowSeconds);
	let changed = false;

	const sign = async (stored: string, owners: Set<string>): Promise<string> => {
		const match = framePattern.exec(stored);
		if (!match || !owners.has(match[1])) return stored;
		changed = true;
		return mediaFrameUrl(host, match[1], match[2], key, expires);
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
		for (const [field, value] of Object.entries(node)) {
			if (typeof value === 'string') {
				if (owners.size && IMAGE_FIELDS.has(field)) node[field] = await sign(value, owners);
			} else if (field === IMAGE_MAP_FIELD && value && typeof value === 'object' && !Array.isArray(value)) {
				for (const [size, url] of Object.entries(value)) if (typeof url === 'string' && owners.size) value[size] = await sign(url, owners);
			} else {
				await walk(value);
			}
		}
	};
	await walk(body);
	return changed ? JSON.stringify(body) : text;
}
